import React, { useState, useEffect } from 'react';
import ItineraryApp from './components/ItineraryApp';
import SharedItineraryView from './components/SharedItineraryView';
import ComparePage from './components/ComparePage';
import ErrorBoundary from './components/ErrorBoundary';
import AMapLoader from '@amap/amap-jsapi-loader';
import { useHashRoute, matchRoute } from './hooks/useHashRoute';
import { I18nProvider, useT } from './i18n';

const AMAP_KEY = process.env.AMAP_API_KEY || '';
const hasValidKey = Boolean(AMAP_KEY) && AMAP_KEY !== 'YOUR_API_KEY';

export default function App() {
  return (
    <I18nProvider>
      <ErrorBoundary>
        <Routes />
      </ErrorBoundary>
    </I18nProvider>
  );
}

function Routes() {
  const t = useT();
  const [amapLoaded, setAmapLoaded] = useState(false);
  const hash = useHashRoute();

  useEffect(() => {
    if (hasValidKey) {
      AMapLoader.load({
        key: AMAP_KEY,
        version: '2.0',
        plugins: ['AMap.PlaceSearch', 'AMap.Geocoder'],
      })
        .then(() => {
          setAmapLoaded(true);
        })
        .catch(e => {
          console.error('AMap load failed:', e);
          setAmapLoaded(true); // Proceed anyway to avoid hanging
        });
    }
  }, []);

  if (!hasValidKey) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-bg-base text-text-main p-6">
        <div className="max-w-lg bg-surface p-8 border border-border rounded-[14px]">
          <h2 className="m-0 mb-4 text-2xl font-display font-semibold">{t('app.amapKey.title')}</h2>
          <p className="mb-4">
            <strong>{t('app.amapKey.step1')}</strong>{' '}
            <a href="https://console.amap.com/dev/key/app" target="_blank" rel="noreferrer">
              {t('app.amapKey.getKey')}
            </a>
          </p>
          <p className="mb-2">
            <strong>{t('app.amapKey.step2')}</strong> {t('app.amapKey.addSecret')}
          </p>
          <ul className="text-left leading-relaxed mb-6 list-disc pl-6">
            <li>{t('app.amapKey.openSettings')}</li>
            <li>{t('app.amapKey.selectSecrets')}</li>
            <li>
              <code>{t('app.amapKey.addKey')}</code>
            </li>
            <li>
              <code>{t('app.amapKey.addCode')}</code>
            </li>
          </ul>
          <p className="m-0 text-text-muted">{t('app.amapKey.rebuild')}</p>
        </div>
      </div>
    );
  }

  if (!amapLoaded) {
    return <div className="flex items-center justify-center min-h-screen bg-bg-base text-text-muted">{t('app.loadingMaps')}</div>;
  }

  const shareMatch = matchRoute('share/:id', hash);
  if (shareMatch) return <SharedItineraryView shareId={shareMatch.id} />;
  if (matchRoute('compare', hash)) return <ComparePage />;
  return <ItineraryApp />;
}
