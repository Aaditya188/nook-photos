/**
 * Trips — auto-detected getaways (time + distance-from-home clustering).
 * /trips lists them as big cover cards; /trip/:id is the full grid.
 */
import { useMemo, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLibraryQ } from '../state/data';
import { useRegisterList, useView } from '../state/view';
import { PhotoGrid } from '../components/PhotoGrid';
import { SelectionBar } from '../components/SelectionBar';
import { EmptyState, ViewHead } from '../components/chrome';
import { useLazyBlob } from '../components/Tile';
import { detectTrips, tripTitle, type Trip } from '../lib/trips';
import { fmtCount } from '../lib/format';

function useTrips(): Trip[] {
  const libQ = useLibraryQ();
  return useMemo(() => detectTrips(libQ.data || []), [libQ.data]);
}

function TripCard({ trip, onClick }: { trip: Trip; onClick: () => void }) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const cover = trip.cover;
  const { src } = useLazyBlob(
    ref,
    'thumb:' + cover.id + ':512' + (cover.editedAt ? ':' + cover.editedAt : ''),
    cover.thumbUrl + '?w=512' + (cover.editedAt ? '&e=' + cover.editedAt : ''),
  );
  const days = Math.round((trip.end.getTime() - trip.start.getTime()) / 86400000) + 1;
  return (
    <button ref={ref} type="button" className="trip-card" onClick={onClick}>
      {src ? <img alt="" draggable={false} src={src} /> : null}
      <div className="trip-grad" />
      <div className="trip-cap">
        <div className="trip-title">{tripTitle(trip)}</div>
        <div className="trip-sub">
          {days === 1 ? '1 day' : days + ' days'} · {fmtCount(trip.photos.length)}
        </div>
      </div>
    </button>
  );
}

export function TripsView() {
  const trips = useTrips();
  const nav = useNavigate();
  useRegisterList(useMemo(() => [], []));

  return (
    <>
      <ViewHead
        title="Trips"
        subtitle={trips.length ? trips.length + (trips.length === 1 ? ' trip' : ' trips') : ''}
      />
      <div id="grid">
        {trips.length === 0 ? (
          <EmptyState kind="places" />
        ) : (
          <div className="trip-grid">
            {trips.map((t) => (
              <TripCard key={t.id} trip={t} onClick={() => nav('/trip/' + t.id)} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export function TripView() {
  const { id = '' } = useParams();
  const trips = useTrips();
  const nav = useNavigate();
  const trip = trips.find((t) => t.id === id) || null;
  const list = trip?.photos ?? [];
  useRegisterList(list);
  const { selectMode, enterSelect, exitSelect } = useView();

  if (!trip) {
    return (
      <>
        <ViewHead title="Trip" back={{ label: 'Trips', to: '/trips' }} />
        <div id="grid">
          <EmptyState kind="generic" />
        </div>
      </>
    );
  }

  return (
    <>
      <ViewHead
        title={tripTitle(trip)}
        subtitle={fmtCount(list.length)}
        back={{ label: 'Trips', to: '/trips' }}
        actions={[
          { label: selectMode ? 'Done' : 'Select', onClick: selectMode ? exitSelect : enterSelect },
          ...(trip.centroid
            ? [
                {
                  label: 'Map',
                  onClick: () => nav('/map'),
                },
              ]
            : []),
        ]}
      />
      <div id="grid">
        <PhotoGrid list={list} grouped />
      </div>
      <SelectionBar list={list} context={{ kind: 'normal' }} />
    </>
  );
}
