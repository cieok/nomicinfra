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
  pulseTimestamp: string;
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

// NIST pulse generation & API release latency buffer in milliseconds (10 seconds)
const NIST_DELAY_OFFSET_MS = 10 * 1000;

export default function Dice(): React.ReactElement {
  // Helper to format a Date into datetime-local string format (YYYY-MM-THH:mm)
  const formatLocalDateTime = (date: Date): string => {
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  };

  // Default initial timestamp set to current time + 1 minute
  const [dateTime, setDateTime] = useState<string>(
    formatLocalDateTime(new Date(Date.now() + 1 * 60 * 1000))
  );
  const [min, setMin] = useState<number | string>(1);
  const [max, setMax] = useState<number | string>(6);

  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [scheduledRoll, setScheduledRoll] = useState<ScheduledRoll | null>(null);
  const [timeRemainingSeconds, setTimeRemainingSeconds] = useState<number | null>(null);
  const [data, setData] = useState<CalculationDetails | null>(null);

  // Function to add 10 minutes to the currently displayed/selected timestamp
  const addTenMinutesToCurrentInput = (): void => {
    const currentMs = new Date(dateTime).getTime();
    if (isNaN(currentMs)) {
      setDateTime(formatLocalDateTime(new Date(Date.now() + 10 * 60 * 1000)));
      return;
    }
    const tenMinInMs = 10 * 60 * 1000;
    const futureDate = new Date(currentMs + tenMinInMs);
    setDateTime(formatLocalDateTime(futureDate));
  };

  // Timer countdown for future rolls including NIST delay buffer
  useEffect(() => {
    if (!scheduledRoll) {
      setTimeRemainingSeconds(null);
      return;
    }

    const updateCountdown = () => {
      // Add the 10-second NIST release delay to target availability time
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
      const timestampMs = new Date(dateTime).getTime();

      if (isNaN(timestampMs)) {
        throw new Error('Invalid date/time selection.');
      }

      const now = Date.now();
      // Require current time to be at least (timestamp + 10 second NIST publication delay)
      const targetAvailableTimeMs = timestampMs + NIST_DELAY_OFFSET_MS;

      // Check if selected time + delay is in the future
      if (now < targetAvailableTimeMs) {
        setScheduledRoll({
          targetTimestampMs: timestampMs,
          targetDateUtc: new Date(timestampMs).toUTCString(),
        });
        setLoading(false);
        return;
      }

      // Fetch pulse from NIST Beacon 2.0 API
      const response = await fetch(
        `https://beacon.nist.gov/beacon/2.0/pulse/time/${timestampMs}`
      );

      // Handle 404 (pulse not yet available or generated on server)
      if (response.status === 404) {
        setScheduledRoll({
          targetTimestampMs: timestampMs,
          targetDateUtc: new Date(timestampMs).toUTCString(),
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
        pulseTimestamp: new Date(pulse.timeStamp).toUTCString(),
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
      return `${mins}m ${secs}s remaining (incl. ~10s NIST publishing delay)`;
    }
    return `${secs}s remaining (incl. ~10s NIST publishing delay)`;
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

      {/* Input Form */}
      <form onSubmit={handleFetchAndCalculate} style={styles.form}>
        <div style={styles.inputGroup}>
          <label style={styles.label}>Select Timestamp:</label>
          <div style={styles.timestampRow}>
            <input
              type="datetime-local"
              value={dateTime}
              onChange={(e) => setDateTime(e.target.value)}
              required
              style={styles.input}
            />
            <button
              type="button"
              onClick={addTenMinutesToCurrentInput}
              style={styles.quickSelectBtn}
              title="Add 10 minutes to the currently displayed time"
            >
              +10 Min
            </button>
          </div>
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
            <span style={styles.scheduledBadge}>Scheduled Roll</span>
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
            NIST generates pulses every 60 seconds with a ~10 second delay for signing and propagation. Once the countdown completes, click <strong>"Roll Dice / Generate"</strong> to retrieve the verifiable random result.
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
            <p><strong>Pulse Time (UTC):</strong> {data.pulseTimestamp}</p>
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
  header: { marginBottom: '1.5rem', textAlign: 'center' },
  title: { margin: '0 0 0.5rem 0', fontSize: '2rem' },
  subtext: { color: '#666', fontSize: '0.95rem', margin: 0 },
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
  timestampRow: { display: 'flex', gap: '0.5rem', alignItems: 'center' },
  inputGroup: { display: 'flex', flexDirection: 'column', flex: 1, gap: '0.25rem' },
  label: { fontSize: '0.875rem', fontWeight: 600, color: '#495057' },
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