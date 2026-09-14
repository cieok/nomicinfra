import React, { useState, useEffect, useCallback } from 'react';
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

interface AttemptRecord {
  attemptIndex: number;
  hexSlice: string;
  decimalValue: string;
  accepted: boolean;
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
  hexCharsNeeded: string;
  usedHexSlice: string;
  totalAttempts: string;
  limit: string;
  capacity: string;
  attemptsLog: AttemptRecord[];
}

interface ScheduledRoll {
  targetTimestampMs: number;
  targetDateUtc: string;
  pulseUri: string;
  shareableUrl: string;
}

// NIST pulse generation, signing & CDN propagation delay buffer in ms (30 seconds)
const NIST_DELAY_OFFSET_MS = 30 * 1000;

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

  // Default initial timestamp set to current UTC time + 1 minute
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

  // Core function to execute roll logic given target parameters
  const executeRoll = useCallback(
    async (targetMs: number, minVal: string | number, maxVal: string | number) => {
      setLoading(true);
      setError(null);
      setData(null);
      setScheduledRoll(null);

      const minNum = BigInt(minVal);
      const maxNum = BigInt(maxVal);

      if (minNum >= maxNum) {
        setError('Minimum value must be strictly less than maximum value.');
        setLoading(false);
        return;
      }

      try {
        if (isNaN(targetMs)) {
          throw new Error('Invalid UTC date/time timestamp.');
        }

        const expectedPulseUri = `https://beacon.nist.gov/beacon/2.0/pulse/time/${targetMs}`;
        const searchParams = new URLSearchParams({
          timestamp: targetMs.toString(),
          min: minVal.toString(),
          max: maxVal.toString(),
        });
        const currentShareableUrl = `${window.location.origin}${window.location.pathname}?${searchParams.toString()}`;

        const now = Date.now();
        const targetAvailableTimeMs = targetMs + NIST_DELAY_OFFSET_MS;

        // Check if target UTC pulse time (+ 30s latency buffer) is in the future
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

        // Fetch pulse from NIST Beacon 2.0 API using UTC timestamp in ms
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

        // --- Rejection Sampling with Minimal Hex Slicing ---
        const rangeSpan = maxNum - minNum + 1n;

        // Minimal bit length required for max offset index (rangeSpan - 1)
        const maxOffsetIndex = rangeSpan - 1n;
        const bitLength = BigInt(maxOffsetIndex.toString(2).length);

        // Minimal hex characters (nibbles) required (4 bits per hex character)
        const hexCharsNeeded = Number((bitLength + 3n) / 4n);

        // Maximum capacity represented by hexCharsNeeded (16^hexCharsNeeded)
        const sliceMaxCapacity = 1n << BigInt(hexCharsNeeded * 4);

        // Rejection limit: largest multiple of rangeSpan below sliceMaxCapacity
        const limit = (sliceMaxCapacity / rangeSpan) * rangeSpan;

        let selectedOffset: bigint | null = null;
        let usedHexSlice = '';
        let totalAttempts = 0;
        let bigIntValue = 0n;
        const attemptsLog: AttemptRecord[] = [];

        // Iterate through hex string in chunks of minimal hex length
        for (let i = 0; i + hexCharsNeeded <= hexOutput.length; i += hexCharsNeeded) {
          totalAttempts++;
          const slice = hexOutput.substring(i, i + hexCharsNeeded);
          const val = BigInt(`0x${slice}`);
          const isAccepted = val < limit;

          attemptsLog.push({
            attemptIndex: totalAttempts,
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
            `Rejection sampling exhausted all ${totalAttempts} hex slices without an unbiased value.`
          );
        }

        const finalRandomValue = minNum + selectedOffset;

        setData({
          pulseTimestampUtc: formatUtcDisplay(pulse.timeStamp),
          pulseUri: expectedPulseUri,
          hexOutput: hexOutput,
          bigIntValue: bigIntValue.toString(),
          min: minNum.toString(),
          max: maxNum.toString(),
          rangeSpan: rangeSpan.toString(),
          moduloResult: selectedOffset.toString(),
          finalRandomValue: finalRandomValue.toString(),
          hexCharsNeeded: hexCharsNeeded.toString(),
          usedHexSlice,
          totalAttempts: totalAttempts.toString(),
          limit: limit.toString(),
          capacity: sliceMaxCapacity.toString(),
          attemptsLog,
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

  // On mount: Read URL parameters and perform roll automatically if timestamp parameter exists
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const timestampParam = params.get('timestamp');
    const minParam = params.get('min');
    const maxParam = params.get('max');

    if (timestampParam) {
      const parsedMs = parseInt(timestampParam, 10);
      if (!isNaN(parsedMs)) {
        const parsedDate = new Date(parsedMs);
        setDateTimeUtc(formatUtcDateTimeInput(parsedDate));

        const activeMin = minParam !== null ? minParam : min;
        const activeMax = maxParam !== null ? maxParam : max;

        if (minParam !== null) setMin(minParam);
        if (maxParam !== null) setMax(maxParam);

        executeRoll(parsedMs, activeMin, activeMax);
      }
    }
  }, [executeRoll]);

  // Handle manual form submissions and sync URL
  const handleFetchAndCalculate = async (
    e: React.FormEvent<HTMLFormElement>
  ): Promise<void> => {
    e.preventDefault();
    const timestampMs = parseUtcTimestampMs(dateTimeUtc);

    if (isNaN(timestampMs)) {
      setError('Invalid UTC date/time selection.');
      return;
    }

    // Update browser URL query parameters without triggering full page reload
    const searchParams = new URLSearchParams(window.location.search);
    searchParams.set('timestamp', timestampMs.toString());
    searchParams.set('min', min.toString());
    searchParams.set('max', max.toString());

    const newUrl = `${window.location.pathname}?${searchParams.toString()}`;
    window.history.pushState({ path: newUrl }, '', newUrl);

    executeRoll(timestampMs, min, max);
  };

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

  // Timer countdown for future rolls including NIST 30s latency buffer
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
    if (seconds <= 0) return 'Pulse available now! Click "Roll Dice / Generate" to fetch.';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins > 0) {
      return `${mins}m ${secs}s remaining (incl. ~30s NIST release buffer)`;
    }
    return `${secs}s remaining (incl. ~30s NIST release buffer)`;
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

          <p style={{ margin: '0.75rem 0 0.5rem 0' }}>
            <strong>Future Dice Roll URL (Share with Players):</strong>
            <br />
            <a
              href={scheduledRoll.shareableUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={styles.backLink}
            >
              <code style={styles.inlineCode}>{scheduledRoll.shareableUrl}</code>
            </a>
          </p>

          <p style={{ margin: '0.5rem 0 1rem 0' }}>
            <strong>Target Pulse URI:</strong>{' '}
            <a
              href={scheduledRoll.pulseUri}
              target="_blank"
              rel="noopener noreferrer"
              style={styles.backLink}
            >
              <code style={styles.inlineCode}>{scheduledRoll.pulseUri}</code>
            </a>
          </p>

          {timeRemainingSeconds !== null && (
            <div style={styles.countdownBox}>
              ⏱️ {formatCountdownText(timeRemainingSeconds)}
            </div>
          )}
          <p style={styles.scheduledNote}>
            NIST generates pulses every 60 seconds (aligned to UTC minute boundaries) with a ~30 second delay for digital signing and distribution. Once the countdown completes, click <strong>"Roll Dice / Generate"</strong> to retrieve the verifiable random result.
          </p>
        </div>
      )}

      {/* Results & Calculations */}
      {data && (
        <div style={styles.resultsContainer}>
          {/* Prominent Result Header */}
          <div style={styles.resultBadge}>
            <span style={styles.badgeLabel}>Final Random Roll</span>
            <span style={styles.badgeValue}>{data.finalRandomValue}</span>
            <span style={styles.badgeSubtext}>
              Valid range: [{data.min} to {data.max}]
            </span>
          </div>

          {/* Section 1: NIST Source Data */}
          <div style={styles.card}>
            <h3 style={styles.cardTitle}>1. NIST Pulse Entropy Source</h3>
            <div style={styles.detailRow}>
              <strong>Pulse Time (UTC):</strong> <span>{data.pulseTimestampUtc}</span>
            </div>
            <div style={styles.detailRow}>
              <strong>Verification URI:</strong>{' '}
              <a
                href={data.pulseUri}
                target="_blank"
                rel="noopener noreferrer"
                style={styles.backLink}
              >
                <code style={styles.inlineCode}>{data.pulseUri}</code>
              </a>
            </div>
            <div style={{ marginTop: '0.75rem' }}>
              <strong>Raw 512-bit Hex Output (64 bytes):</strong>
              <code style={styles.codeBlock}>{data.hexOutput}</code>
            </div>
          </div>

          {/* Section 2: Step-by-Step Unbiased Calculation */}
          <div style={styles.card}>
            <h3 style={styles.cardTitle}>2. Cryptographic Mapping & Verification</h3>
            <p style={styles.sectionExplainer}>
              To guarantee fair outcomes without <strong>Modulo Bias</strong>, we use <em>rejection sampling</em>. 
              We slice minimal hex chunks from the 512-bit output and reject values falling into uneven remainder zones.
            </p>

            {/* Step A */}
            <div style={styles.stepBox}>
              <div style={styles.stepHeader}>
                <span style={styles.stepBadge}>Step A</span>
                <strong>Determine Range & Minimal Hex Chunk Size</strong>
              </div>
              <p style={styles.stepDescription}>
                Calculate the span N and find the minimum number of hex characters needed to represent N - 1.
              </p>
              <div style={styles.formulaBlock}>
                <div>Span (N) = Max - Min + 1 = <strong>{data.rangeSpan}</strong> possible values</div>
                <div>Hex Characters Needed = <strong>{data.hexCharsNeeded}</strong> char(s) (1 char = 4 bits)</div>
                <div>Maximum Chunk Capacity (16<sup>{data.hexCharsNeeded}</sup>) = <strong>{data.capacity}</strong></div>
              </div>
            </div>

            {/* Step B */}
            <div style={styles.stepBox}>
              <div style={styles.stepHeader}>
                <span style={styles.stepBadge}>Step B</span>
                <strong>Calculate Unbiased Rejection Limit</strong>
              </div>
              <p style={styles.stepDescription}>
                The rejection limit is the largest multiple of N that fits within total capacity. 
                Values strictly less than this limit guarantee equal probability for every number.
              </p>
              <div style={styles.formulaBlock}>
                <div>Limit = floor(Capacity / N) × N</div>
                <div>Limit = floor({data.capacity} / {data.rangeSpan}) × {data.rangeSpan} = <strong>{data.limit}</strong></div>
              </div>
            </div>

            {/* Step C: Rejection Sampling Log */}
            <div style={styles.stepBox}>
              <div style={styles.stepHeader}>
                <span style={styles.stepBadge}>Step C</span>
                <strong>Rejection Sampling Attempts ({data.totalAttempts} total)</strong>
              </div>
              <p style={styles.stepDescription}>
                Sequential evaluation of {data.hexCharsNeeded}-character hex slices from the output pulse. Slices ≥ {data.limit} are discarded.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {data.attemptsLog.map((attempt) => (
                  <div
                    key={attempt.attemptIndex}
                    style={{
                      ...styles.formulaBlock,
                      borderLeft: attempt.accepted ? '4px solid #2b8a3e' : '4px solid #e03131',
                      backgroundColor: attempt.accepted ? '#f8f9fa' : '#fff5f5',
                    }}
                  >
                    <div>
                      <strong>Attempt #{attempt.attemptIndex}:</strong> Chunk <code style={styles.inlineCode}>"0x{attempt.hexSlice}"</code> → Decimal (X) = <strong>{attempt.decimalValue}</strong>
                    </div>
                    <div style={styles.statusCheck}>
                      Validation: {attempt.decimalValue} {attempt.accepted ? '<' : '≥'} {data.limit}{' '}
                      {attempt.accepted ? (
                        <span style={styles.validBadge}>✓ ACCEPTED</span>
                      ) : (
                        <span style={styles.rejectedBadge}>✕ REJECTED (Modulo Bias)</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Step D */}
            <div style={styles.stepBox}>
              <div style={styles.stepHeader}>
                <span style={styles.stepBadge}>Step D</span>
                <strong>Map Offset to Output Range</strong>
              </div>
              <p style={styles.stepDescription}>
                Map the validated decimal value into your desired range using modulo arithmetic.
              </p>
              <div style={styles.formulaBlock}>
                <div>Offset Index = X mod N = {data.bigIntValue} mod {data.rangeSpan} = <strong>{data.moduloResult}</strong></div>
                <div>Final Result = Min + Offset = {data.min} + {data.moduloResult} = <strong style={styles.finalHighlight}>{data.finalRandomValue}</strong></div>
              </div>
            </div>
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
  badgeSubtext: {
    fontSize: '0.85rem',
    color: '#495057',
    marginTop: '0.25rem',
  },
  card: {
    backgroundColor: '#fff',
    border: '1px solid #dee2e6',
    borderRadius: '8px',
    padding: '1.25rem',
  },
  cardTitle: { marginTop: 0, marginBottom: '0.75rem', fontSize: '1.1rem' },
  detailRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '0.35rem 0',
    borderBottom: '1px solid #f1f3f5',
    fontSize: '0.9rem',
  },
  sectionExplainer: {
    fontSize: '0.875rem',
    color: '#495057',
    lineHeight: 1.5,
    marginBottom: '1rem',
  },
  stepBox: {
    backgroundColor: '#f8f9fa',
    border: '1px solid #e9ecef',
    borderRadius: '6px',
    padding: '0.85rem 1rem',
    marginBottom: '0.85rem',
  },
  stepHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    marginBottom: '0.35rem',
    fontSize: '0.95rem',
  },
  stepBadge: {
    backgroundColor: '#495057',
    color: '#fff',
    fontSize: '0.7rem',
    fontWeight: 'bold',
    padding: '0.15rem 0.45rem',
    borderRadius: '4px',
  },
  stepDescription: {
    margin: '0 0 0.5rem 0',
    fontSize: '0.825rem',
    color: '#6c757d',
  },
  formulaBlock: {
    backgroundColor: '#fff',
    border: '1px solid #dee2e6',
    borderRadius: '4px',
    padding: '0.6rem 0.75rem',
    fontFamily: 'monospace',
    fontSize: '0.85rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.35rem',
  },
  statusCheck: {
    marginTop: '0.25rem',
    paddingTop: '0.25rem',
    borderTop: '1px dashed #dee2e6',
    fontWeight: 'bold',
  },
  validBadge: {
    color: '#2b8a3e',
    backgroundColor: '#d3f9d8',
    padding: '0.1rem 0.4rem',
    borderRadius: '4px',
    marginLeft: '0.5rem',
    fontSize: '0.75rem',
  },
  rejectedBadge: {
    color: '#e03131',
    backgroundColor: '#ffe3e3',
    padding: '0.1rem 0.4rem',
    borderRadius: '4px',
    marginLeft: '0.5rem',
    fontSize: '0.75rem',
  },
  finalHighlight: {
    color: '#1864ab',
    fontSize: '1rem',
  },
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