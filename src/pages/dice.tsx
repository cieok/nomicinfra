import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';


type DiceValue = 1 | 2 | 3 | 4 | 5 | 6;

// 1. Your React Component
export default function Dice(): React.ReactElement {
  const [currentRoll, setCurrentRoll] = useState<DiceValue>(1);
  const [isRolling, setIsRolling] = useState<boolean>(false);

  const rollDice = (): void => {
    setIsRolling(true);
    setTimeout(() => {
      const nextRoll = (Math.floor(Math.random() * 6) + 1) as DiceValue;
      setCurrentRoll(nextRoll);
      setIsRolling(false);
    }, 300);
  };

  return (
    <div style={styles.container}>
      <h1>Dice Roller</h1>

      <div style={styles.diceBox}>
        <span style={styles.diceValue}>
          {isRolling ? '...' : currentRoll}
        </span>
      </div>

      <button onClick={rollDice} disabled={isRolling} style={styles.button}>
        {isRolling ? 'Rolling...' : 'Roll Dice'}
      </button>

      <div style={styles.footer}>
        <a href="/">← Back to Main App</a>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'system-ui, sans-serif' },
  diceBox: { width: '100px', height: '100px', border: '2px solid #333', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '1.5rem 0', backgroundColor: '#f9f9f9' },
  diceValue: { fontSize: '2.5rem', fontWeight: 'bold' },
  button: { padding: '0.75rem 1.5rem', fontSize: '1rem', fontWeight: 'bold', cursor: 'pointer', borderRadius: '8px' },
  footer: { marginTop: '2rem' },
};

// 2. THIS WAS MISSING — You must mount it to #dice-root!
const rootElement = document.getElementById('dice-root');

if (!rootElement) {
  throw new Error("Failed to find '#dice-root' in dice.html");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <Dice />
  </React.StrictMode>
);