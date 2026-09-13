import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';

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

interface CalculationDetails {
  pulseTimestampUtc: string;
  pulseUri: string;
  hexOutput: string;
  bigIntValue: string;
  min: string;
  max: string;
  rangeSpan: string;
  moduloResult: string;
  finalRandomValue: string;
}

interface ScheduledRoll {
  targetTimestampMs: number;
  targetDateUtc: string;
}

// NIST pulse generation, signing & CDN propagation delay buffer in ms (25 seconds)
const NIST_DELAY_OFFSET_MS = 25 * 1000;

export default function Dice(): React.ReactElement {
  // Helper to format a Date into UTC YYYY-MM-DDTHH:mm string format for <input>
  const formatUtcDateTimeInput = (date: Date): string => {
    return date.toISOString().slice(0, 16);
  };

  // Helper to parse a YYYY-MM-DDTHH:mm string strictly as UTC
  const parseUtcTimestampMs = (dateTimeStr: string): number => {
    if (!dateTimeStr) return NaN;
    // Append 'Z' to force parsing as UTC ISO string regardless of local browser timezone
    const utcIsoStr = dateTimeStr.endsWith('Z') ? dateTimeStr : `${dateTimeStr}:00Z`;
    return new Date(utcIsoStr).getTime();
  };

  // Helper to format UTC Date to human-readable string (e.g. "Sun, 13 Sep 2026 09:30:00 UTC")
  const formatUtcDisplay = (dateStrOrMs: string | number): string => {
    const date = new Date(dateStrOrMs);
    return isNaN(date.getTime()) ? '' : `${date.toUTCString()} (UTC)`;
  };

  // Default initial timestamp set to current UTC time + 1 minutes
  const [dateTimeUtc, setDateTimeUtc] = useState<string>(
    formatUtcDateTimeInput(new Date(Date.now() + 1 * 60 * 1000))
  );
  const [min, setMin] = useState<number | string>(1);
  const [max, setMax] = useState<number | string>(6);

  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [scheduledRoll, setScheduledRoll] = useState<ScheduledRoll | null>(null);
  const [timeRemainingSeconds, setTimeRemainingSeconds] = useState<number | null>(null);
  const [data, setData] = useState<CalculationDetails | null>(null);

  // Function to add 10 minutes (in UTC) to the currently displayed timestamp input
  const addTenMinutesToCurrentInput = (): void => {
    const currentMs = parseUtcTimestampMs(dateTimeUtc);
    if (isNaN(currentMs)) {
      setDateTimeUtc(formatUtcDateTimeInput(new Date(Date.now() + 10 * 60 * 1000)));
      return;
    }
    const tenMinInMs = 10 * 60 * 1000;
    const futureDate = new Date(currentMs + tenMinInMs);
    setDateTimeUtc(formatUtcDateTimeInput(futureDate));
  };

  // Timer countdown for future rolls including NIST 25s latency buffer
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

  const handleFetchAndCalculate = async (
    e: React.FormEvent<HTMLFormElement>
  ): Promise<void> => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setData(null);
    setScheduledRoll(null);

    const minNum = BigInt(min);
    const maxNum = BigInt(max);

    if (minNum >= maxNum) {
      setError('Minimum value must be strictly less than maximum value.');
      setLoading(false);
      return;
    }

    try {
      const timestampMs = parseUtcTimestampMs(dateTimeUtc);

      if (isNaN(timestampMs)) {
        throw new Error('Invalid UTC date/time selection.');
      }

      const now = Date.now();
      const targetAvailableTimeMs = timestampMs + NIST_DELAY_OFFSET_MS;

      // Check if target UTC pulse time (+ 25s latency buffer) is in the future
      if (now < targetAvailableTimeMs) {
        setScheduledRoll({
          targetTimestampMs: timestampMs,
          targetDateUtc: formatUtcDisplay(timestampMs),
        });
        setLoading(false);
        return;
      }

      // Fetch pulse from NIST Beacon 2.0 API using UTC timestamp in ms
      const response = await fetch(
        `https://beacon.nist.gov/beacon/2.0/pulse/time/${timestampMs}`
      );

      if (response.status === 404) {
        setScheduledRoll({
          targetTimestampMs: timestampMs,
          targetDateUtc: formatUtcDisplay(timestampMs),
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

      const hexOutput = pulse.outputValue;

      // 512-bit arithmetic using BigInt
      const bigIntValue = BigInt(`0x${hexOutput}`);
      const rangeSpan = maxNum - minNum + 1n;
      const moduloResult = bigIntValue % rangeSpan;
      const finalRandomValue = minNum + moduloResult;

      setData({
        pulseTimestampUtc: formatUtcDisplay(pulse.timeStamp),
        pulseUri: pulse.uri,
        hexOutput: hexOutput,
        bigIntValue: bigIntValue.toString(),
        min: minNum.toString(),
        max: maxNum.toString(),
        rangeSpan: rangeSpan.toString(),
        moduloResult: moduloResult.toString(),
        finalRandomValue: finalRandomValue.toString(),
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
  };

  const formatCountdownText = (seconds: number | null): string => {
    if (seconds === null) return '';
    if (seconds <= 0) return 'Pulse available now! Click "Roll Dice / Generate" to fetch.';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins > 0) {
      return `${mins}m ${secs}s remaining (incl. ~25s NIST release buffer)`;
    }
    return `${secs}s remaining (incl. ~25s NIST release buffer)`;
  };

  return (
    <div style={styles.container}>
      {/* Top Navigation */}
      <nav style={styles.topNav}>
        <a href="/" style={styles.backLink}>
          ← Back to Ruleset Comparison
        </a>
      </nav>

      <header style={styles.header}>
        <h1 style={styles.title}>NIST Beacon 2.0 Dice Roller</h1>
        <p style={styles.subtext}>
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
      <section style={styles.nomicInfoCard}>
        <h2 style={styles.nomicTitle}>🎲 Why Use This for Online Nomic?</h2>
        <ul style={styles.nomicList}>
         
          <li>
            <strong>Verifiable & Anti-Cheat:</strong> NIST pulses are cryptographically signed using RSA/SHA-512 by a government agency, making them impossible to alter if you have no control over the agency.
          </li>
          <li>
            <strong>Pre-Commitment Mechanism:</strong> Players can agree on a target UTC timestamp <em>in advance</em> (e.g., "The turn 14 roll will
             use the NIST pulse at 18:00 UTC"). Because the future pulse output is mathematically unpredictable by anyone prior to release, no 
             player can choose when to roll or delete roll based on favorable odds.
          </li>
          <li>
            <strong>Asynchronous Friendly:</strong> Ideal for play-by-forum or play-by-mail Nomic. Anyone can independently calculate and verify the exact same outcome from the NIST archive using the exact deterministic formula shown below.
          </li>
        </ul>
      </section>

      {/* Input Form */}
      <form onSubmit={handleFetchAndCalculate} style={styles.form}>
        <div style={styles.inputGroup}>
          <div style={styles.labelRow}>
            <label style={styles.label}>Select Target Timestamp (UTC):</label>
            <span style={styles.utcBadge}>UTC ONLY</span>
          </div>
          <div style={styles.timestampRow}>
            <input
              type="datetime-local"
              value={dateTimeUtc}
              onChange={(e) => setDateTimeUtc(e.target.value)}
              required
              style={styles.input}
            />
            <button
              type="button"
              onClick={addTenMinutesToCurrentInput}
              style={styles.quickSelectBtn}
              title="Add 10 minutes (UTC) to current selection"
            >
              +10 Min
            </button>
          </div>
          <span style={styles.helpText}>
            Selected UTC: {formatUtcDisplay(parseUtcTimestampMs(dateTimeUtc))}
          </span>
        </div>

        <div style={styles.row}>
          <div style={styles.inputGroup}>
            <label style={styles.label}>Range Min:</label>
            <input
              type="number"
              value={min}
              onChange={(e) => setMin(e.target.value)}
              required
              style={styles.input}
            />
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>Range Max:</label>
            <input
              type="number"
              value={max}
              onChange={(e) => setMax(e.target.value)}
              required
              style={styles.input}
            />
          </div>
        </div>

        <button type="submit" disabled={loading} style={styles.button}>
          {loading ? 'Fetching Beacon Data...' : 'Roll Dice / Generate'}
        </button>
      </form>

      {/* Errors */}
      {error && <div style={styles.errorCard}>{error}</div>}

      {/* Future Roll Scheduled Card */}
      {scheduledRoll && (
        <div style={styles.scheduledCard}>
          <div style={styles.scheduledHeader}>
            <span style={styles.scheduledBadge}>Scheduled Roll (UTC)</span>
          </div>
          <p style={styles.scheduledMainText}>
            The NIST pulse for this roll will be published at:
          </p>
          <p style={styles.scheduledTimeText}>{scheduledRoll.targetDateUtc}</p>
          {timeRemainingSeconds !== null && (
            <div style={styles.countdownBox}>
              ⏱️ {formatCountdownText(timeRemainingSeconds)}
            </div>
          )}
          <p style={styles.scheduledNote}>
            NIST generates pulses every 60 seconds (aligned to UTC minute boundaries) with a ~25 second delay for digital signing and distribution. Once the countdown completes, click <strong>"Roll Dice / Generate"</strong> to retrieve the verifiable random result.
          </p>
        </div>
      )}

      {/* Results & Calculations */}
      {data && (
        <div style={styles.resultsContainer}>
          <div style={styles.resultBadge}>
            <span style={styles.badgeLabel}>Random Value</span>
            <span style={styles.badgeValue}>{data.finalRandomValue}</span>
          </div>

          <div style={styles.card}>
            <h3 style={styles.cardTitle}>1. NIST Pulse Details</h3>
            <p><strong>Pulse Time (UTC):</strong> {data.pulseTimestampUtc}</p>
            <p><strong>URI:</strong> <code style={styles.inlineCode}>{data.pulseUri}</code></p>
            <p style={{ wordBreak: 'break-all' }}>
              <strong>Raw 512-bit Hex Output:</strong>
              <br />
              <code style={styles.codeBlock}>{data.hexOutput}</code>
            </p>
          </div>

          <div style={styles.card}>
            <h3 style={styles.cardTitle}>2. Step-by-Step Calculation</h3>

            <p><strong>Step A: Convert Hex Output to 512-bit Decimal (X)</strong></p>
            <code style={styles.codeBlock}>X = {data.bigIntValue}</code>

            <p><strong>Step B: Calculate Range Size (N)</strong></p>
            <code style={styles.codeBlock}>
              N = Max - Min + 1 = {data.max} - {data.min} + 1 = {data.rangeSpan}
            </code>

            <p><strong>Step C: Compute Modulo Offset (Offset = X mod N)</strong></p>
            <code style={styles.codeBlock}>
              Offset = {data.bigIntValue} % {data.rangeSpan} = {data.moduloResult}
            </code>

            <p><strong>Step D: Map to Selected Range (Result = Min + Offset)</strong></p>
            <code style={styles.codeBlock}>
              Result = {data.min} + {data.moduloResult} = {data.finalRandomValue}
            </code>
          </div>
        </div>
      )}

      {/* Footer link */}
      <div style={styles.footer}>
        <a href="/" style={styles.backLink}>
          ← Back to Main App
        </a>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: '720px',
    margin: '0 auto',
    padding: '1.5rem 1rem 2rem 1rem',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    color: '#333',
    minHeight: '100vh',
    boxSizing: 'border-box',
  },
  topNav: {
    marginBottom: '1rem',
  },
  backLink: {
    color: '#0066cc',
    textDecoration: 'none',
    fontWeight: 600,
    fontSize: '0.95rem',
  },
  header: { marginBottom: '1.25rem', textAlign: 'center' },
  title: { margin: '0 0 0.5rem 0', fontSize: '2rem' },
  subtext: { color: '#666', fontSize: '0.95rem', margin: 0 },
  nomicInfoCard: {
    backgroundColor: '#f1f8ff',
    border: '1px solid #c8e1ff',
    borderRadius: '8px',
    padding: '1rem 1.25rem',
    marginBottom: '1.5rem',
  },
  nomicTitle: {
    margin: '0 0 0.5rem 0',
    fontSize: '1.1rem',
    color: '#0366d6',
  },
  nomicList: {
    margin: 0,
    paddingLeft: '1.25rem',
    fontSize: '0.9rem',
    lineHeight: '1.5',
    color: '#24292e',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
    background: '#f8f9fa',
    padding: '1.25rem',
    borderRadius: '8px',
    border: '1px solid #e9ecef',
  },
  row: { display: 'flex', gap: '1rem' },
  labelRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  utcBadge: {
    backgroundColor: '#0366d6',
    color: '#fff',
    fontSize: '0.7rem',
    fontWeight: 'bold',
    padding: '0.15rem 0.4rem',
    borderRadius: '4px',
    letterSpacing: '0.5px',
  },
  timestampRow: { display: 'flex', gap: '0.5rem', alignItems: 'center' },
  inputGroup: { display: 'flex', flexDirection: 'column', flex: 1, gap: '0.25rem' },
  label: { fontSize: '0.875rem', fontWeight: 600, color: '#495057' },
  helpText: { fontSize: '0.78rem', color: '#6c757d', marginTop: '0.15rem' },
  input: {
    padding: '0.5rem',
    borderRadius: '4px',
    border: '1px solid #ced4da',
    fontSize: '1rem',
    flex: 1,
  },
  quickSelectBtn: {
    padding: '0.55rem 0.85rem',
    backgroundColor: '#e9ecef',
    color: '#495057',
    border: '1px solid #ced4da',
    borderRadius: '4px',
    fontSize: '0.875rem',
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  button: {
    padding: '0.75rem',
    backgroundColor: '#0066cc',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    fontSize: '1rem',
    fontWeight: 'bold',
    cursor: 'pointer',
    marginTop: '0.5rem',
  },
  errorCard: {
    marginTop: '1rem',
    padding: '1rem',
    backgroundColor: '#f8d7da',
    color: '#721c24',
    borderRadius: '6px',
    border: '1px solid #f5c6cb',
  },
  scheduledCard: {
    marginTop: '1.5rem',
    padding: '1.25rem',
    backgroundColor: '#eebf3110',
    border: '2px dashed #e0a800',
    borderRadius: '8px',
    textAlign: 'center',
  },
  scheduledHeader: {
    marginBottom: '0.5rem',
  },
  scheduledBadge: {
    backgroundColor: '#e0a800',
    color: '#fff',
    fontSize: '0.75rem',
    fontWeight: 'bold',
    textTransform: 'uppercase',
    padding: '0.25rem 0.6rem',
    borderRadius: '12px',
  },
  scheduledMainText: {
    margin: '0.5rem 0 0.25rem 0',
    fontSize: '1rem',
    fontWeight: 600,
    color: '#495057',
  },
  scheduledTimeText: {
    margin: '0 0 0.75rem 0',
    fontSize: '1.2rem',
    fontWeight: 'bold',
    color: '#212529',
  },
  countdownBox: {
    backgroundColor: '#fff',
    border: '1px solid #ffe8a1',
    borderRadius: '6px',
    padding: '0.6rem 1rem',
    display: 'inline-block',
    fontWeight: 'bold',
    fontSize: '1.1rem',
    color: '#856404',
    marginBottom: '0.75rem',
  },
  scheduledNote: {
    fontSize: '0.875rem',
    color: '#6c757d',
    margin: 0,
    lineHeight: 1.4,
  },
  resultsContainer: { marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' },
  resultBadge: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    backgroundColor: '#e7f5ff',
    border: '2px solid #339af0',
    borderRadius: '8px',
    padding: '1rem',
  },
  badgeLabel: { fontSize: '0.875rem', color: '#1864ab', textTransform: 'uppercase', fontWeight: 'bold' },
  badgeValue: { fontSize: '3rem', fontWeight: 'bold', color: '#1864ab' },
  card: {
    backgroundColor: '#fff',
    border: '1px solid #dee2e6',
    borderRadius: '8px',
    padding: '1.25rem',
  },
  cardTitle: { marginTop: 0, marginBottom: '0.75rem', fontSize: '1.1rem' },
  inlineCode: { background: '#f1f3f5', padding: '0.2rem 0.4rem', borderRadius: '4px' },
  codeBlock: {
    display: 'block',
    background: '#f1f3f5',
    padding: '0.5rem 0.75rem',
    borderRadius: '4px',
    fontSize: '0.85rem',
    wordBreak: 'break-all',
    marginTop: '0.25rem',
  },
  footer: { marginTop: '2rem', textAlign: 'center' },
};

// Mount to `#dice-root`
const rootElement = document.getElementById('dice-root');

if (!rootElement) {
  throw new Error("Failed to find '#dice-root' in dice.html");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <Dice />
  </React.StrictMode>
);