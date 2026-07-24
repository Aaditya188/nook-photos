/**
 * Recap — a shareable "Your Year" highlight page: hero stats, monthly activity,
 * and a spread of highlight photos, computed client-side (shared @nook/core).
 */
import { useMemo, useState } from 'react';
import { availableYears, recapForYear } from '@nook/core';
import { useLibraryQ } from '../state/data';
import { useView, useRegisterList } from '../state/view';
import { ViewHead } from '../components/chrome';
import { MiniThumb } from './Storage';

const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const n = (v: number) => v.toLocaleString('en-US');

export function RecapView() {
  const libQ = useLibraryQ();
  const { openLightbox } = useView();
  const photos = libQ.data || [];
  const years = useMemo(() => availableYears(photos), [photos]);
  const [year, setYear] = useState<number | null>(null);
  const activeYear = year ?? years[0] ?? new Date().getFullYear();
  const recap = useMemo(() => recapForYear(photos, activeYear), [photos, activeYear]);
  useRegisterList(recap.highlights);

  const maxMonth = Math.max(1, ...recap.byMonth);

  return (
    <>
      <ViewHead title="Recap" />
      <div id="grid">
        <div className="rc-wrap">
          {years.length > 1 ? (
            <div className="rc-years">
              {years.map((y) => (
                <button
                  key={y}
                  type="button"
                  className={'rc-year-pill' + (y === activeYear ? ' active' : '')}
                  onClick={() => setYear(y)}
                >
                  {y}
                </button>
              ))}
            </div>
          ) : null}

          <div className="rc-hero">
            <div className="rc-hero-kicker">Your year in photos</div>
            <div className="rc-hero-year">{activeYear}</div>
          </div>

          <div className="rc-stats">
            <Stat value={n(recap.photoCount)} label="photos" />
            <Stat value={n(recap.videoCount)} label="videos" />
            <Stat value={n(recap.favoriteCount)} label="favorites" />
            <Stat value={n(recap.activeDays)} label="days with photos" />
            {recap.places > 0 ? <Stat value={n(recap.places)} label="places" /> : null}
          </div>

          <section className="rc-section">
            <h2 className="rc-h">Across the year</h2>
            <div className="rc-months">
              {recap.byMonth.map((c, i) => (
                <div key={i} className="rc-month">
                  <div className="rc-month-bar-track">
                    <div className="rc-month-bar" style={{ height: (c / maxMonth) * 100 + '%' }} />
                  </div>
                  <div className="rc-month-label">{MONTHS[i]}</div>
                </div>
              ))}
            </div>
            {recap.busiestDay ? (
              <div className="rc-note">
                Busiest day: {new Date(recap.busiestDay.date).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} ·{' '}
                {n(recap.busiestDay.count)} photos
              </div>
            ) : null}
          </section>

          {recap.highlights.length ? (
            <section className="rc-section">
              <h2 className="rc-h">Highlights</h2>
              <div className="rc-highlights">
                {recap.highlights.map((p) => (
                  <MiniThumb key={p.id} photo={p} size={256} onClick={() => openLightbox(p.id)} />
                ))}
              </div>
            </section>
          ) : (
            <div className="rc-note">No photos from {activeYear} yet.</div>
          )}
        </div>
      </div>
    </>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rc-stat">
      <div className="rc-stat-num">{value}</div>
      <div className="rc-stat-label">{label}</div>
    </div>
  );
}
