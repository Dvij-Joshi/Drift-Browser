import { useState, useEffect, useRef } from 'react'
import bgImage from './assets/bg.jpg'

/* ────────────────────────────────────────────────────────
   Types
──────────────────────────────────────────────────────── */
interface Tab {
  id: string
  title: string
  url: string
  icon: string
  active: boolean
}

interface Shortcut {
  id: string
  label: string
  initial: string
  url: string
}

/* ────────────────────────────────────────────────────────
   Initial Data
──────────────────────────────────────────────────────── */
const INITIAL_TABS: Tab[] = [
  { id: '1', title: 'New Tab', url: 'drift://new-tab', icon: 'home', active: true },
  { id: '2', title: 'Workspace', url: 'https://workspace.google.com', icon: 'space_dashboard', active: false },
  { id: '3', title: 'Design Docs', url: 'https://docs.google.com', icon: 'description', active: false },
]

const SHORTCUTS: Shortcut[] = [
  { id: 'gh', label: 'GitHub', initial: 'G', url: 'https://github.com' },
  { id: 'fig', label: 'Figma', initial: 'F', url: 'https://figma.com' },
  { id: 'docs', label: 'Docs', initial: 'D', url: 'https://docs.google.com' },
  { id: 'mail', label: 'Mail', initial: 'M', url: 'https://mail.google.com' },
]

/* ────────────────────────────────────────────────────────
   Helpers
──────────────────────────────────────────────────────── */
function getGreeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0')
  const s = (seconds % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

/* ────────────────────────────────────────────────────────
   Sub-components
──────────────────────────────────────────────────────── */
function Greeting(): React.JSX.Element {
  const [time, setTime] = useState(new Date())

  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  return (
    <div style={styles.greeting}>
      <p style={styles.greetingMain}>{getGreeting()}, User.</p>
      <p style={styles.greetingSub}>
        {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · Stay in the flow.
      </p>
    </div>
  )
}

function PomodoroWidget(): React.JSX.Element {
  const [seconds, setSeconds] = useState(25 * 60)
  const [running, setRunning] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(() => {
        setSeconds((s) => (s > 0 ? s - 1 : 0))
      }, 1000)
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [running])

  return (
    <button
      className="drift-pomodoro"
      style={styles.widget}
      onClick={() => setRunning((r) => !r)}
      title={running ? 'Pause focus timer' : 'Start focus timer'}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
        {running ? 'pause' : 'play_arrow'}
      </span>
      <span style={styles.widgetMono}>{formatTime(seconds)}</span>
      <span style={styles.widgetLabel}>FOCUS</span>
    </button>
  )
}

function WeatherWidget(): React.JSX.Element {
  return (
    <div style={styles.weatherWidget}>
      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>partly_cloudy_day</span>
      <span style={styles.widgetMono}>Partly Cloudy · 72°F · San Francisco</span>
    </div>
  )
}

function SearchBar(): React.JSX.Element {
  const [query, setQuery] = useState('')

  const handleSearch = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' && query.trim()) {
      // In a real browser this would navigate; here we just clear
      setQuery('')
    }
  }

  return (
    <div style={styles.searchWrapper}>
      <span className="material-symbols-outlined" style={styles.searchIcon}>search</span>
      <input
        className="drift-search"
        style={styles.searchInput}
        type="text"
        placeholder="Focus on..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleSearch}
        autoFocus
      />
      <span style={styles.searchBrand}>Drift</span>
    </div>
  )
}

function Shortcuts(): React.JSX.Element {
  return (
    <div style={styles.shortcuts}>
      {SHORTCUTS.map((s) => (
        <div
          key={s.id}
          className="drift-shortcut"
          style={styles.shortcut}
        >
          <div
            className="drift-shortcut-icon"
            style={styles.shortcutIcon}
          >
            {s.initial}
          </div>
          <span style={styles.shortcutLabel}>{s.label}</span>
        </div>
      ))}
    </div>
  )
}

function TabBar({
  tabs,
  onSelect,
  onClose,
  onNew,
}: {
  tabs: Tab[]
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onNew: () => void
}): React.JSX.Element {
  return (
    <div style={styles.tabBar} className="no-scrollbar">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className="drift-tab"
          style={{
            ...styles.tab,
            background: tab.active ? 'var(--zen-4)' : 'var(--zen-2)',
            color: tab.active ? 'var(--zen-1)' : 'var(--zen-4)',
          }}
          onClick={() => onSelect(tab.id)}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 15, flexShrink: 0 }}>
            {tab.icon}
          </span>
          <span style={styles.tabTitle}>{tab.title}</span>
          <button
            className="drift-tab-close"
            style={styles.tabClose}
            onClick={(e) => { e.stopPropagation(); onClose(tab.id) }}
            title="Close tab"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 13 }}>close</span>
          </button>
        </div>
      ))}
      <button className="drift-new-tab" style={styles.newTabBtn} onClick={onNew} title="New tab">
        <span className="material-symbols-outlined" style={{ fontSize: 20 }}>add</span>
      </button>
    </div>
  )
}

function NavBar({ activeTab }: { activeTab: Tab | undefined }): React.JSX.Element {
  const [url, setUrl] = useState(activeTab?.url ?? 'drift://new-tab')

  useEffect(() => {
    setUrl(activeTab?.url ?? 'drift://new-tab')
  }, [activeTab?.id])

  return (
    <nav style={styles.navBar}>
      {/* Left Actions */}
      <div style={styles.navActions}>
        <button className="drift-nav-btn" style={styles.navBtn} title="Back">
          <span className="material-symbols-outlined">arrow_back</span>
        </button>
        <button style={{ ...styles.navBtn, opacity: 0.35, cursor: 'not-allowed' }} title="Forward" disabled>
          <span className="material-symbols-outlined">arrow_forward</span>
        </button>
        <button className="drift-nav-btn" style={styles.navBtn} title="Reload">
          <span className="material-symbols-outlined">refresh</span>
        </button>
      </div>

      {/* URL Bar */}
      <div style={styles.urlBarWrapper}>
        <span className="material-symbols-outlined" style={styles.urlLock}>lock</span>
        <input
          style={styles.urlInput}
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onFocus={(e) => e.target.select()}
        />
        <button style={styles.navBtn} title="Bookmark">
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>star_border</span>
        </button>
      </div>

      {/* Right Actions */}
      <div style={styles.navActions}>
        <button className="drift-nav-btn" style={styles.navBtn} title="Bookmarks">
          <span className="material-symbols-outlined">bookmark_border</span>
        </button>
        <button className="drift-nav-btn" style={styles.navBtn} title="Incognito">
          <span className="material-symbols-outlined">visibility_off</span>
        </button>
        <button className="drift-nav-btn" style={styles.navBtn} title="Menu">
          <span className="material-symbols-outlined">more_vert</span>
        </button>
      </div>
    </nav>
  )
}

/* ────────────────────────────────────────────────────────
   Main App
──────────────────────────────────────────────────────── */
function App(): React.JSX.Element {
  const [tabs, setTabs] = useState<Tab[]>(INITIAL_TABS)
  const activeTab = tabs.find((t) => t.active)

  const selectTab = (id: string): void => {
    setTabs((prev) => prev.map((t) => ({ ...t, active: t.id === id })))
  }

  const closeTab = (id: string): void => {
    setTabs((prev) => {
      const remaining = prev.filter((t) => t.id !== id)
      if (remaining.length === 0) return prev // don't close last tab
      const wasActive = prev.find((t) => t.id === id)?.active
      if (wasActive) {
        const lastIdx = remaining.length - 1
        remaining[lastIdx] = { ...remaining[lastIdx], active: true }
      }
      return remaining
    })
  }

  const newTab = (): void => {
    const id = Date.now().toString()
    setTabs((prev) => [
      ...prev.map((t) => ({ ...t, active: false })),
      { id, title: 'New Tab', url: 'drift://new-tab', icon: 'home', active: true },
    ])
  }

  return (
    <div style={styles.root}>
      {/* Background */}
      <div style={{ ...styles.bg, backgroundImage: `url(${bgImage})` }} />
      <div style={styles.bgOverlay} />

      {/* Main content area */}
      <main style={styles.main}>
        <Greeting />

        {/* Center dashboard */}
        <div style={styles.dashboard}>
          <SearchBar />
          <Shortcuts />
        </div>

        {/* Floating widgets — bottom right area above nav */}
        <div style={styles.widgets}>
          <PomodoroWidget />  {/* drift-pomodoro class applied inside */}
          <WeatherWidget />
        </div>
      </main>

      {/* Bottom floating strip */}
      <div style={styles.bottomStrip}>
        <TabBar tabs={tabs} onSelect={selectTab} onClose={closeTab} onNew={newTab} />
        <NavBar activeTab={activeTab} />
      </div>
    </div>
  )
}

/* ────────────────────────────────────────────────────────
   Styles (inline — no external framework dependency)
──────────────────────────────────────────────────────── */
const styles: Record<string, React.CSSProperties> = {
  root: {
    position: 'relative',
    width: '100vw',
    height: '100vh',
    overflow: 'hidden',
    fontFamily: 'var(--font-sans)',
    color: 'var(--zen-4)',
  },
  bg: {
    position: 'absolute',
    inset: 0,
    backgroundSize: 'cover',
    backgroundPosition: 'center center',
    backgroundRepeat: 'no-repeat',
    zIndex: 0,
  },
  bgOverlay: {
    position: 'absolute',
    inset: 0,
    background: 'rgba(245,239,230,0.38)',
    zIndex: 1,
    pointerEvents: 'none',
  },
  main: {
    position: 'relative',
    zIndex: 2,
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 170,
    paddingInline: 40,
  },
  greeting: {
    position: 'absolute',
    top: 32,
    left: 40,
    zIndex: 5,
  },
  greetingMain: {
    fontSize: 18,
    fontWeight: 500,
    color: 'var(--zen-4)',
    letterSpacing: '-0.01em',
  },
  greetingSub: {
    fontSize: 13,
    opacity: 0.6,
    marginTop: 2,
    fontFamily: 'var(--font-mono)',
  },
  dashboard: {
    position: 'relative',
    zIndex: 5,
    width: '100%',
    maxWidth: 640,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 36,
  },
  // Search
  searchWrapper: {
    width: '100%',
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
  },
  searchIcon: {
    position: 'absolute',
    left: 24,
    fontSize: 20,
    color: 'var(--zen-4)',
    opacity: 0.5,
    pointerEvents: 'none',
    zIndex: 1,
  },
  searchInput: {
    width: '100%',
    background: 'rgba(245,239,230,0.88)',
    border: '2px solid var(--zen-2)',
    borderRadius: 9999,
    padding: '14px 64px 14px 56px',
    fontSize: 18,
    fontWeight: 500,
    color: 'var(--zen-4)',
    fontFamily: 'var(--font-sans)',
    transition: 'border-color 200ms, background 200ms, box-shadow 200ms',
    backdropFilter: 'blur(4px)',
  },
  searchBrand: {
    position: 'absolute',
    right: 24,
    fontSize: 12,
    fontFamily: 'var(--font-mono)',
    color: 'var(--zen-4)',
    opacity: 0.4,
    letterSpacing: '0.04em',
    pointerEvents: 'none',
  },
  // Shortcuts
  shortcuts: {
    display: 'flex',
    gap: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shortcut: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
    cursor: 'pointer',
  },
  shortcutIcon: {
    width: 48,
    height: 48,
    borderRadius: 9999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 18,
    fontWeight: 600,
    color: 'var(--zen-4)',
    transition: 'background 200ms, transform 200ms',
  },
  shortcutLabel: {
    fontSize: 13,
    color: 'var(--zen-4)',
    fontWeight: 400,
  },
  // Widgets
  widgets: {
    position: 'absolute',
    bottom: 188,
    right: 40,
    zIndex: 5,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  widget: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    background: 'var(--zen-2)',
    border: '2px solid var(--zen-2)',
    borderRadius: 9999,
    padding: '8px 18px',
    color: 'var(--zen-4)',
    cursor: 'pointer',
    transition: 'border-color 200ms, background 200ms',
    fontFamily: 'var(--font-sans)',
  },
  widgetMono: {
    fontFamily: 'var(--font-mono)',
    fontSize: 13,
  },
  widgetLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.08em',
    opacity: 0.6,
  },
  weatherWidget: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    background: 'rgba(232,223,202,0.8)',
    border: '2px solid transparent',
    borderRadius: 9999,
    padding: '8px 18px',
    color: 'var(--zen-4)',
    backdropFilter: 'blur(4px)',
  },
  // Bottom strip
  bottomStrip: {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    paddingBottom: 28,
    paddingInline: 24,
    gap: 6,
    pointerEvents: 'none',
  },
  // Tab bar
  tabBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    width: '95%',
    maxWidth: 960,
    overflowX: 'auto',
    paddingInline: 4,
    pointerEvents: 'auto',
  },
  tab: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    borderRadius: 9999,
    padding: '7px 14px',
    minWidth: 160,
    maxWidth: 220,
    cursor: 'pointer',
    transition: 'background 200ms',
    flexShrink: 0,
  },
  tabTitle: {
    fontSize: 13,
    fontWeight: 400,
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  tabClose: {
    opacity: 0,
    marginLeft: 4,
    borderRadius: 9999,
    padding: 2,
    color: 'inherit',
    transition: 'opacity 150ms',
    cursor: 'pointer',
  },
  newTabBtn: {
    width: 36,
    height: 36,
    borderRadius: 9999,
    background: 'var(--zen-2)',
    color: 'var(--zen-4)',
    flexShrink: 0,
    marginLeft: 2,
    transition: 'background 200ms',
    cursor: 'pointer',
  },
  // Nav bar
  navBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 0,
    background: 'var(--zen-2)',
    color: 'var(--zen-4)',
    borderRadius: 9999,
    padding: '10px 20px',
    width: '95%',
    maxWidth: 960,
    pointerEvents: 'auto',
    boxShadow: '0 4px 24px rgba(120,149,178,0.12)',
  },
  navActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    flexShrink: 0,
  },
  navBtn: {
    color: 'var(--zen-4)',
    borderRadius: 9999,
    padding: 4,
    transition: 'color 150ms, background 150ms',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
  },
  urlBarWrapper: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginInline: 24,
    position: 'relative',
    background: 'rgba(245,239,230,0.7)',
    borderRadius: 9999,
    padding: '6px 14px 6px 10px',
  },
  urlLock: {
    fontSize: 16,
    opacity: 0.5,
    flexShrink: 0,
  },
  urlInput: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'var(--font-mono)',
    color: 'var(--zen-4)',
    textAlign: 'center',
    background: 'transparent',
    minWidth: 0,
    letterSpacing: '0.01em',
  },
}

export default App
