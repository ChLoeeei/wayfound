import React, { useState, useEffect } from 'react';
import ItineraryApp from './components/ItineraryApp';
import SharedItineraryView from './components/SharedItineraryView';
import ErrorBoundary from './components/ErrorBoundary';
import AMapLoader from '@amap/amap-jsapi-loader';
import { useHashRoute, matchRoute } from './hooks/useHashRoute';

const AMAP_KEY = process.env.AMAP_API_KEY || '';
const hasValidKey = Boolean(AMAP_KEY) && AMAP_KEY !== 'YOUR_API_KEY';

export default function App() {
  const [darkMode, setDarkMode] = useState(false);
  const [amapLoaded, setAmapLoaded] = useState(false);
  const hash = useHashRoute();

  useEffect(() => {
    if (darkMode) {
      document.body.classList.add('dark');
    } else {
      document.body.classList.remove('dark');
    }
  }, [darkMode]);

  useEffect(() => {
    if (hasValidKey) {
      AMapLoader.load({
        key: AMAP_KEY,
        version: "2.0",
        plugins: ['AMap.PlaceSearch', 'AMap.Geocoder']
      }).then(() => {
        setAmapLoaded(true);
      }).catch(e => {
        console.error("AMap load failed:", e);
        setAmapLoaded(true); // Proceed anyway to avoid hanging
      });
    }
  }, []);

  if (!hasValidKey) {
    return (
      <div className="flex items-center justify-center h-screen bg-bg-base text-text-main font-sans p-6">
        <div className="text-center max-w-lg bg-surface p-8 border border-border shadow-md">
          <h2 className="text-2xl font-display mb-4">Amap API Key Required</h2>
          <p className="mb-4"><strong>Step 1:</strong> <a className="underline" href="https://console.amap.com/dev/key/app" target="_blank" rel="noreferrer">Get an API Key from Amap</a></p>
          <p className="mb-2"><strong>Step 2:</strong> Add your key and security code as a secret in AI Studio:</p>
          <ul className="text-left leading-relaxed mb-6 list-disc pl-6">
            <li>Open <strong>Settings</strong> (⚙️ gear icon, <strong>top-right corner</strong>)</li>
            <li>Select <strong>Secrets</strong></li>
            <li>Add <code>AMAP_API_KEY</code> = Web JS API Key</li>
            <li>Add <code>AMAP_SECURITY_CODE</code> = Web Security Code</li>
          </ul>
          <p className="text-text-muted">The app rebuilds automatically after you add the secret.</p>
        </div>
      </div>
    );
  }

  if (!amapLoaded) {
    return <div className="flex items-center justify-center h-screen bg-bg-base text-text-muted">Loading maps...</div>;
  }

  const shareMatch = matchRoute('share/:id', hash);

  return (
    <ErrorBoundary>
      {shareMatch ? (
        <SharedItineraryView shareId={shareMatch.id} />
      ) : (
        <ItineraryApp darkMode={darkMode} setDarkMode={setDarkMode} />
      )}
    </ErrorBoundary>
  );
}

