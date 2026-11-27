export function EventViewNavigation({ view }: { view: 'events' | 'calendar' }) {
  return (
    <nav className="event-view-choice" aria-label="Ansicht">
      <a href="#events" aria-current={view === 'events' ? 'page' : undefined}>
        Liste
      </a>
      <a
        href="#calendar"
        aria-current={view === 'calendar' ? 'page' : undefined}
      >
        Kalender
      </a>
    </nav>
  );
}
