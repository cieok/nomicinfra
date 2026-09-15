import React, { useState, useEffect, useCallback } from 'react';
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
  const formatUtcDateTimeInput = (date: Date): string => {
    return date.toISOString().slice(0, 16);
  };

  const parseUtcTimestampMs = (dateTimeStr: string): number => {
    if (!dateTimeStr) return NaN;
    const utcIsoStr = dateTimeStr.endsWith('Z') ? dateTimeStr : `${dateTimeStr}:00Z`;
    return new Date(utcIsoStr).getTime();
  };

  const formatUtcDisplay = (dateStrOrMs: string | number): string => {
    const date = new Date(dateStrOrMs);
    return isNaN(date.getTime()) ? '' : `${date.toUTCString()} (UTC)`;
  };

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
  const [copied, setCopied] = useState<boolean>(false);

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

        let selectedOffset: bigint | null = null;
        let usedHexSlice = '';
        let totalAttempts = 0;
        let bigIntValue = 0n;
        const attemptsLog: AttemptRecord[] = [];

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

  const handleFetchAndCalculate = async (
    e: React.FormEvent<HTMLFormElement>
  ): Promise<void> => {
    e.preventDefault();
    const timestampMs = parseUtcTimestampMs(dateTimeUtc);

    if (isNaN(timestampMs)) {
      setError('Invalid UTC date/time selection.');
      return;
    }

    const searchParams = new URLSearchParams(window.location.search);
    searchParams.set('timestamp', timestampMs.toString());
    searchParams.set('min', min.toString());
    searchParams.set('max', max.toString());

    const newUrl = `${window.location.pathname}?${searchParams.toString()}`;
    window.history.pushState({ path: newUrl }, '', newUrl);

    executeRoll(timestampMs, min, max);
  };

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
            <label className={styles.label}>Select Target Timestamp (UTC):</label>
            <span className={styles.utcBadge}>UTC ONLY</span>
          </div>
          <div className={styles.timestampRow}>
            <input
              type="datetime-local"
              value={dateTimeUtc}
              onChange={(e) => setDateTimeUtc(e.target.value)}
              required
              className={styles.input}
            />
            <button
              type="button"
              onClick={addTenMinutesToCurrentInput}
              className={styles.quickSelectBtn}
              title="Add 10 minutes (UTC) to current selection"
            >
              +10 Min
            </button>
          </div>
          <span className={styles.helpText}>
            Selected UTC: {formatUtcDisplay(parseUtcTimestampMs(dateTimeUtc))}
          </span>
        </div>

        <div className={styles.row}>
          <div className={styles.inputGroup}>
            <label className={styles.label}>Range Min:</label>
            <input
              type="number"
              value={min}
              onChange={(e) => setMin(e.target.value)}
              required
              className={styles.input}
            />
          </div>

          <div className={styles.inputGroup}>
            <label className={styles.label}>Range Max:</label>
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
          <p className={styles.scheduledMainText}>
            The NIST pulse for this roll will be published at:
          </p>
          <p className={styles.scheduledTimeText}>{scheduledRoll.targetDateUtc}</p>

          <div className={styles.sectionSpacing}>
            <strong>Future Dice Roll URL (Share with Players):</strong>
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

          <div className={styles.subSectionSpacing}>
            <strong>Target Pulse URI:</strong>{' '}
            <div className={styles.noticeBox}>
              ℹ️ <strong>Note:</strong> Accessing the NIST URI above prior to release will display{' '}
              <code className={styles.inlineCode}>"Pulse Not Available."</code> until the countdown expires.
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

          {timeRemainingSeconds !== null && (
            <div className={styles.countdownBox}>
              ⏱️ {formatCountdownText(timeRemainingSeconds)}
            </div>
          )}

          <button
            onClick={() => executeRoll(scheduledRoll.targetTimestampMs, min, max)}
            disabled={loading || isScheduledRollDisabled}
            className={`${styles.button} ${styles.fullWidthBtn} ${
              isScheduledRollDisabled ? styles.disabledBtn : ''
            }`}
          >
            {isScheduledRollDisabled
              ? 'Pulse Not Available (Waiting for NIST...)'
              : 'Fetch Verifiable Pulse Now'}
          </button>

          <p className={styles.scheduledNote}>
            NIST generates pulses every 60 seconds (aligned to UTC minute boundaries) with a ~30 second delay for digital signing and distribution.
          </p>
        </div>
      )}

      {/* Results & Calculations */}
      {data && (
        <div className={styles.resultsContainer}>
          {/* Prominent Result Header */}
          <div className={styles.resultBadge}>
            <span className={styles.badgeLabel}>Final Random Roll</span>
            <span className={styles.badgeValue}>{data.finalRandomValue}</span>
            <span className={styles.badgeSubtext}>
              Valid range: [{data.min} to {data.max}]
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

            {/* Step C: Rejection Sampling Log */}
            <div className={styles.stepBox}>
              <div className={styles.stepHeader}>
                <span className={styles.stepBadge}>Step C</span>
                <strong>Rejection Sampling Attempts ({data.totalAttempts} total)</strong>
              </div>
              <p className={styles.stepDescription}>
                Sequential evaluation of {data.hexCharsNeeded}-character hex slices from the output pulse. Slices ≥ {data.limit} are discarded.
              </p>
              <div className={styles.attemptsContainer}>
                {data.attemptsLog.map((attempt) => (
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
            </div>

            {/* Step D */}
            <div className={styles.stepBox}>
              <div className={styles.stepHeader}>
                <span className={styles.stepBadge}>Step D</span>
                <strong>Map Offset to Output Range</strong>
              </div>
              <p className={styles.stepDescription}>
                Map the validated decimal value into your desired range using modulo arithmetic.
              </p>
              <div className={styles.formulaBlock}>
                <div>Offset Index = X mod N = {data.bigIntValue} mod {data.rangeSpan} = <strong>{data.moduloResult}</strong></div>
                <div>Final Result = Min + Offset = {data.min} + {data.moduloResult} = <strong className={styles.finalHighlight}>{data.finalRandomValue}</strong></div>
              </div>
            </div>
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