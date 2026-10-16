import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAggregateHealth } from '../../../services/onlineMusic/aggregateHealth';

// src/components/app/search/AggregateSourceStatus.tsx
// Explain automatic source selection using measurements from real searches and verified media requests.
export default function AggregateSourceStatus() {
    const { t } = useTranslation();
    const { sources, selected } = useAggregateHealth();
    const rows = Object.entries(sources);
    return (
        <details className="max-h-40 overflow-auto rounded-xl bg-current/[0.04] px-3 py-2 text-xs" data-aggregate-status>
            <summary className="cursor-pointer opacity-75">
                {t('musicfree.aggregatePolicy', { count: rows.length })}
                {selected && sources[selected] ? ` · ${t('musicfree.selectedSource', { name: sources[selected].name })}` : ''}
            </summary>
            <ul className="mt-2 space-y-1.5" aria-label={t('musicfree.sourceMeasurements')}>
                {rows.map(([id, source]) => (
                    <li key={id} className="flex flex-wrap justify-between gap-x-4 opacity-75">
                        <span>{source.name}</span>
                        <span>
                            {t('musicfree.searchLatency')}: {source.searchState === 'error' ? t('musicfree.failed')
                                : source.searchMs === undefined ? t('musicfree.untested') : `${source.searchMs} ms`}
                            {' · '}{t('musicfree.audioLatency')}: {source.audioState === 'preview' ? t('musicfree.previewSkipped')
                                : source.audioState === 'error' ? t('musicfree.failed')
                                    : source.audioMs === undefined ? t('musicfree.untested') : `${source.audioMs} ms`}
                        </span>
                    </li>
                ))}
            </ul>
        </details>
    );
}
