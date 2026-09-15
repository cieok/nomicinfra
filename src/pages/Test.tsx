

import React from 'react';
import ReactDOM from 'react-dom/client';
import styles from './Test.module.css';

export function Test() {
  return <div className={styles.container}>Hello World</div>;
}

// Mount directly to test-root
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Test />
  </React.StrictMode>
);