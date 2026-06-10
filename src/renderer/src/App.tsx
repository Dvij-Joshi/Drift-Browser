/**
 * Drift Browser — App.tsx
 *
 * Architecture for performance:
 * - useReducer: all tab mutations are batched through a single dispatch
 * - React.memo + custom comparators: components only re-render when their
 *   specific slice of data changes (not on title/favicon/loading churn)
 * - useCallback with stable deps: event handlers never recreate unless needed
 * - Webviews NEVER destroyed on tab switch — toggled with display:none/flex
 *   so the page's JS context, scroll position, and form state are preserved
 * - Imperative navigation via webview.loadURL() for existing tabs — avoids
 *   changing the `src` prop (which would force a full remount / reload)
 * - New-tab webviews are lazy: no <webview> element exists until the user
 *   first navigates away from the new-tab page
 */

import { useState, useEffect, useRef, useCallback, useReducer, memo } from 'react'
import type { WebviewTag } from './webview.d'
import bgImage from './assets/bg.jpg'

/* ────────────────────────────────────────────────────────
   Types
──────────────────────────────────────────────────────── */
interface Tab {
  id: string
  /** Committed URL — drives <webview src> and persists webview mounting */
  url: string
  /** What's displayed in the URL bar; may differ while user is typing */
  pendingUrl: string
  title: string
  favicon: string   // either a remote URL (https://...) or Material icon name
  active: boolean
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

type TabAction =
  | { type: 'ADD';    tab: Tab }
  | { type: 'CLOSE';  id: string }
  | { type: 'SWITCH'; id: string }
  | { type: 'PATCH';  id: string; patch: Partial<Tab> }

interface Shortcut { id: string; label: string; letter: string; url: string }

/* ────────────────────────────────────────────────────────
   Constants
──────────────────────────────────────────────────────── */
const NEW_TAB_URL = 'drift://new-tab'

const SHORTCUTS: Shortcut[] = [
  { id: 'gh',   label: 'GitHub', letter: 'G', url: 'https://github.com' },
  { id: 'fig',  label: 'Figma',  letter: 'F', url: 'https://figma.com' },
  { id: 'docs', label: 'Docs',   letter: 'D', url: 'https://docs.google.com' },
  { id: 'mail', label: 'Mail',   letter: 'M', url: 'https://mail.google.com' },
]

let _nextId = 1
const uid = () => `t${_nextId++}`

function makeTab(url = NEW_TAB_URL): Tab {
  return {
    id: uid(), url, pendingUrl: isNewTabUrl(url) ? '' : url,
    title: 'New Tab', favicon: 'home',
    active: true, isLoading: false, canGoBack: false, canGoForward: false,
  }
}

/* ────────────────────────────────────────────────────────
   URL helpers
──────────────────────────────────────────────────────── */
function isNewTabUrl(url: string): boolean {
  return !url || url === NEW_TAB_URL || url === 'about:blank'
}

/** Parse raw address-bar input into a navigable URL */
function parseInput(raw: string): string {
  const s = raw.trim()
  if (!s) return NEW_TAB_URL
  if (s === NEW_TAB_URL) return NEW_TAB_URL
  // Already a full URL
  if (/^https?:\/\//i.test(s)) return s
  if (/^file:\/\//i.test(s))   return s
  // Looks like a hostname  (e.g. "github.com" or "localhost:3000")
  if (/^[a-z0-9]([a-z0-9-]*\.)+[a-z]{2,}(:\d+)?(\/.*)?$/i.test(s)) return `https://${s}`
  if (/^localhost(:\d+)?(\/.*)?$/i.test(s)) return `http://${s}`
  // Fallback: Google search
  return `https://www.google.com/search?q=${encodeURIComponent(s)}`
}

/** Pretty-print URL for the address bar */
function prettyUrl(url: string): string {
  if (isNewTabUrl(url)) return ''
  try {
    const { hostname, pathname, search } = new URL(url)
    const path = (pathname + search).replace(/\/$/, '')
    return path ? `${hostname}${path}` : hostname
  } catch {
    return url
  }
}

/* ────────────────────────────────────────────────────────
   Tab reducer — all mutations are pure & batched
──────────────────────────────────────────────────────── */
function tabReducer(tabs: Tab[], action: TabAction): Tab[] {
  switch (action.type) {
    case 'ADD':
      return [...tabs.map(t => ({ ...t, active: false })), action.tab]

    case 'CLOSE': {
      const next = tabs.filter(t => t.id !== action.id)
      if (!next.length) return tabs                          // never close last tab
      if (tabs.find(t => t.id === action.id)?.active) {
        // Activate the tab to the left (or the new last tab)
        const closedIdx = tabs.findIndex(t => t.id === action.id)
        const activateIdx = Math.max(0, Math.min(closedIdx, next.length - 1))
        next[activateIdx] = { ...next[activateIdx], active: true }
      }
      return next
    }

    case 'SWITCH':
      return tabs.map(t => ({ ...t, active: t.id === action.id }))

    case 'PATCH':
      return tabs.map(t => t.id === action.id ? { ...t, ...action.patch } : t)

    default: return tabs
  }
}

/* ────────────────────────────────────────────────────────
   TabWebview — a single webview, always in DOM, toggled
   via display. Uses a stable initial src on mount; further
   navigation is done imperatively via webview.loadURL().
──────────────────────────────────────────────────────── */
interface TabWebviewProps {
  tabId: string
  initialUrl: string
  isActive: boolean
  onUpdate: (tabId: string, patch: Partial<Tab>) => void
  onRef:    (tabId: string, el: WebviewTag | null) => void
  onNewWindow: (url: string) => void
}

const TabWebview = memo(
  function TabWebview({ tabId, initialUrl, isActive, onUpdate, onRef, onNewWindow }: TabWebviewProps) {
    const elRef = useRef<WebviewTag | null>(null)

    // Stable ref-setter so the element ref is captured once
    const setRef = useCallback((el: HTMLElement | null) => {
      const wv = el as WebviewTag | null
      elRef.current = wv
      onRef(tabId, wv)
    }, [tabId, onRef])

    // Wire all Electron webview events imperatively after mount
    useEffect(() => {
      const wv = elRef.current
      if (!wv) return

      const onStart  = () => onUpdate(tabId, { isLoading: true })
      const onStop   = () => onUpdate(tabId, {
        isLoading: false,
        canGoBack: wv.canGoBack(),
        canGoForward: wv.canGoForward(),
      })
      const onNav    = (e: unknown) => { const ev = e as { url: string }; onUpdate(tabId, {
        url: ev.url, pendingUrl: ev.url,
        canGoBack: wv.canGoBack(), canGoForward: wv.canGoForward(),
      })}
      const onNavSPA = (e: unknown) => { const ev = e as { url: string; isMainFrame: boolean }; if (ev.isMainFrame) onUpdate(tabId, { url: ev.url, pendingUrl: ev.url }) }
      const onTitle  = (e: unknown) => { const ev = e as { title: string }; onUpdate(tabId, { title: ev.title || 'New Tab' }) }
      const onFavicon = (e: unknown) => { const ev = e as { favicons: string[] }; if (ev.favicons?.[0]) onUpdate(tabId, { favicon: ev.favicons[0] }) }
      const onNewWin = (e: unknown) => { const ev = e as { url: string }; onNewWindow(ev.url) }
      const onFail   = () => onUpdate(tabId, { isLoading: false })

      wv.addEventListener('did-start-loading',    onStart)
      wv.addEventListener('did-stop-loading',     onStop)
      wv.addEventListener('did-fail-load',        onFail)
      wv.addEventListener('did-navigate',         onNav)
      wv.addEventListener('did-navigate-in-page', onNavSPA)
      wv.addEventListener('page-title-updated',   onTitle)
      wv.addEventListener('page-favicon-updated', onFavicon)
      wv.addEventListener('new-window',           onNewWin)

      return () => {
        wv.removeEventListener('did-start-loading',    onStart)
        wv.removeEventListener('did-stop-loading',     onStop)
        wv.removeEventListener('did-fail-load',        onFail)
        wv.removeEventListener('did-navigate',         onNav)
        wv.removeEventListener('did-navigate-in-page', onNavSPA)
        wv.removeEventListener('page-title-updated',   onTitle)
        wv.removeEventListener('page-favicon-updated', onFavicon)
        wv.removeEventListener('new-window',           onNewWin)
      }
    // Run once per tab — the callbacks are stable (useCallback in parent)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tabId])

    // Capture the src URL exactly once at mount — never change it.
    // Subsequent navigations are done imperatively via wv.loadURL().
    // Changing the src prop aborts the ongoing load (root cause of ERR_ABORTED).
    const mountedUrlRef = useRef(initialUrl)

    return (
      <webview
        ref={setRef as unknown as React.Ref<HTMLElement>}
        src={mountedUrlRef.current}
        style={{
          position: 'absolute',
          top: 0, left: 0, right: 0, bottom: 0,
          width: '100%',
          height: '100%',
          display: isActive ? 'block' : 'none',
          border: 'none',
          outline: 'none',
        }}
      />
    )
  },
  // Only re-render when active state or tab id changes — NOT on url/title/favicon changes.
  // url changes would mutate mountedUrlRef.current indirectly via the src prop, aborting loads.
  (prev, next) =>
    prev.isActive === next.isActive &&
    prev.tabId    === next.tabId,
)

/* ────────────────────────────────────────────────────────
   WebviewLayer — renders all live webviews, layered below
   the UI chrome. New-tab pages never get a webview here.
──────────────────────────────────────────────────────── */
const WebviewLayer = memo(function WebviewLayer({
  tabs,
  onUpdate,
  onRef,
  onNewWindow,
}: {
  tabs: Tab[]
  onUpdate: (id: string, patch: Partial<Tab>) => void
  onRef: (id: string, el: WebviewTag | null) => void
  onNewWindow: (url: string) => void
}) {
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 3 }}>
      {tabs
        .filter(t => !isNewTabUrl(t.url))
        .map(t => (
          <TabWebview
            key={t.id}
            tabId={t.id}
            initialUrl={t.url}
            isActive={t.active}
            onUpdate={onUpdate}
            onRef={onRef}
            onNewWindow={onNewWindow}
          />
        ))}
    </div>
  )
})

/* ────────────────────────────────────────────────────────
   Greeting (top-left clock — updates every minute)
──────────────────────────────────────────────────────── */
const Greeting = memo(function Greeting() {
  const [time, setTime] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  const h = time.getHours()
  const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <div style={S.greeting}>
      <p style={S.greetingMain}>{greet}, User.</p>
      <p style={S.greetingSub}>
        {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · Stay in the flow.
      </p>
    </div>
  )
})

/* ────────────────────────────────────────────────────────
   Pomodoro Timer Widget
──────────────────────────────────────────────────────── */
const PomodoroWidget = memo(function PomodoroWidget() {
  const [secs, setSecs] = useState(25 * 60)
  const [running, setRunning] = useState(false)
  const ref = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (running) ref.current = setInterval(() => setSecs(s => Math.max(0, s - 1)), 1000)
    else if (ref.current) clearInterval(ref.current)
    return () => { if (ref.current) clearInterval(ref.current) }
  }, [running])

  const mm = String(Math.floor(secs / 60)).padStart(2, '0')
  const ss = String(secs % 60).padStart(2, '0')

  return (
    <button
      className="drift-pomodoro"
      style={S.widget}
      onClick={() => setRunning(r => !r)}
      title={running ? 'Pause' : 'Start focus timer'}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 15 }}>
        {running ? 'pause' : 'play_arrow'}
      </span>
      <span style={S.widgetMono}>{mm}:{ss}</span>
      <span style={S.widgetLabel}>FOCUS</span>
    </button>
  )
})

/* ────────────────────────────────────────────────────────
   Weather Widget (static demo)
──────────────────────────────────────────────────────── */
const WeatherWidget = memo(function WeatherWidget() {
  return (
    <div style={S.weatherWidget}>
      <span className="material-symbols-outlined" style={{ fontSize: 15 }}>partly_cloudy_day</span>
      <span style={S.widgetMono}>Partly Cloudy · 72°F · SF</span>
    </div>
  )
})

/* ────────────────────────────────────────────────────────
   New Tab Dashboard (shown when active tab has no URL)
──────────────────────────────────────────────────────── */
function NewTabDashboard({ onNavigate }: { onNavigate: (url: string) => void }) {
  const [query, setQuery] = useState('')

  const submit = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { onNavigate(parseInput(query)); setQuery('') }
  }

  return (
    // Wrapper must be position:absolute inset:0 so absolutely-positioned
    // children (bg, overlay, greeting, dashboard) use this as their containing block
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      {/* Scenic background */}
      <div style={{ ...S.bg, backgroundImage: `url(${bgImage})` }} />
      <div style={S.bgOverlay} />

      {/* Greeting */}
      <Greeting />

      {/* Center dashboard */}
      <div style={S.dashboard}>
        {/* Search bar */}
        <div style={S.searchWrapper}>
          <span className="material-symbols-outlined" style={S.searchIcon}>search</span>
          <input
            className="drift-search"
            style={S.searchInput}
            placeholder="Focus on..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={submit}
            autoFocus
          />
          <span style={S.searchBrand}>Drift</span>
        </div>

        {/* Quick shortcuts */}
        <div style={S.shortcuts}>
          {SHORTCUTS.map(s => (
            <div
              key={s.id}
              className="drift-shortcut"
              style={S.shortcut}
              onClick={() => onNavigate(s.url)}
            >
              <div className="drift-shortcut-icon" style={S.shortcutIcon}>{s.letter}</div>
              <span style={S.shortcutLabel}>{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Widgets (bottom-right, above nav strip) */}
      <div style={S.widgets}>
        <PomodoroWidget />
        <WeatherWidget />
      </div>
      {/* end widgets */}
    </div>
  )
}

/* ────────────────────────────────────────────────────────
   Loading bar (thin progress strip at top of content area)
──────────────────────────────────────────────────────── */
const LoadingBar = memo(function LoadingBar({ loading }: { loading: boolean }) {
  if (!loading) return null
  return (
    <div style={S.loadingTrack}>
      <div className="drift-loading-bar" style={S.loadingBar} />
    </div>
  )
})

/* ────────────────────────────────────────────────────────
   Individual Tab pill (memoized — re-renders only when
   its own title, favicon, loading or active state changes)
──────────────────────────────────────────────────────── */
const TabItem = memo(
  function TabItem({ tab, onSelect, onClose }: {
    tab: Tab
    onSelect: (id: string) => void
    onClose:  (id: string) => void
  }) {
    const hasFavicon = tab.favicon.startsWith('http')
    return (
      <div
        className="drift-tab"
        style={{
          ...S.tab,
          background: tab.active ? 'var(--zen-4)' : 'var(--zen-2)',
          color:      tab.active ? 'var(--zen-1)' : 'var(--zen-4)',
        }}
        onClick={() => onSelect(tab.id)}
        title={tab.title}
      >
        {tab.isLoading
          ? <span className="material-symbols-outlined" style={{ fontSize: 14, flexShrink: 0 }}>progress_activity</span>
          : hasFavicon
            ? <img src={tab.favicon} width={14} height={14} style={{ borderRadius: 2, flexShrink: 0 }} alt="" />
            : <span className="material-symbols-outlined" style={{ fontSize: 14, flexShrink: 0 }}>{tab.favicon}</span>
        }
        <span style={S.tabTitle}>{tab.title}</span>
        <button
          className="drift-tab-close"
          style={S.tabClose}
          onClick={e => { e.stopPropagation(); onClose(tab.id) }}
          title="Close tab"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 12 }}>close</span>
        </button>
      </div>
    )
  },
  (p, n) =>
    p.tab.title    === n.tab.title    &&
    p.tab.favicon  === n.tab.favicon  &&
    p.tab.active   === n.tab.active   &&
    p.tab.isLoading === n.tab.isLoading,
)

/* ────────────────────────────────────────────────────────
   Tab Bar (memoized — re-renders when tab list changes)
──────────────────────────────────────────────────────── */
const TabBar = memo(function TabBar({ tabs, onSelect, onClose, onNew }: {
  tabs: Tab[]
  onSelect: (id: string) => void
  onClose:  (id: string) => void
  onNew:    () => void
}) {
  return (
    <div style={S.tabBar} className="no-scrollbar">
      {tabs.map(tab => (
        <TabItem key={tab.id} tab={tab} onSelect={onSelect} onClose={onClose} />
      ))}
      <button className="drift-new-tab" style={S.newTabBtn} onClick={onNew} title="New tab">
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add</span>
      </button>
    </div>
  )
})

/* ────────────────────────────────────────────────────────
   Nav Bar — URL bar + back / forward / reload
   Keeps internal URL state so typing doesn't cause a
   global re-render; syncs in when active tab changes.
──────────────────────────────────────────────────────── */
interface NavBarProps {
  activeTab: Tab | undefined
  onNavigate:   (url: string) => void
  onBack:       () => void
  onForward:    () => void
  onReload:     () => void
}

const NavBar = memo(function NavBar({ activeTab, onNavigate, onBack, onForward, onReload }: NavBarProps) {
  // Local URL bar state — only syncs from props when the active tab changes
  const [barUrl, setBarUrl] = useState(activeTab ? prettyUrl(activeTab.url) : '')
  const activeId = activeTab?.id

  // Sync URL bar when switching tabs OR when the webview finishes navigating
  useEffect(() => {
    setBarUrl(activeTab ? prettyUrl(activeTab.url) : '')
  }, [activeId, activeTab?.url])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { onNavigate(barUrl); (e.target as HTMLInputElement).blur() }
    if (e.key === 'Escape') { setBarUrl(activeTab ? prettyUrl(activeTab.url) : ''); (e.target as HTMLInputElement).blur() }
  }

  const isNewTab = !activeTab || isNewTabUrl(activeTab.url)

  return (
    <nav style={S.navBar}>
      {/* Left — back / forward / reload */}
      <div style={S.navActions}>
        <button
          className="drift-nav-btn"
          style={{ ...S.navBtn, opacity: activeTab?.canGoBack ? 1 : 0.3, pointerEvents: activeTab?.canGoBack ? 'auto' : 'none' }}
          onClick={onBack} title="Go back"
        >
          <span className="material-symbols-outlined">arrow_back</span>
        </button>
        <button
          className="drift-nav-btn"
          style={{ ...S.navBtn, opacity: activeTab?.canGoForward ? 1 : 0.3, pointerEvents: activeTab?.canGoForward ? 'auto' : 'none' }}
          onClick={onForward} title="Go forward"
        >
          <span className="material-symbols-outlined">arrow_forward</span>
        </button>
        <button
          className="drift-nav-btn"
          style={S.navBtn}
          onClick={activeTab?.isLoading ? onReload : onReload}
          title={activeTab?.isLoading ? 'Stop' : 'Reload'}
        >
          <span className="material-symbols-outlined">
            {activeTab?.isLoading ? 'close' : 'refresh'}
          </span>
        </button>
      </div>

      {/* Center — URL bar */}
      <div style={S.urlBarWrapper}>
        <span
          className="material-symbols-outlined"
          style={{ ...S.urlLock, color: isNewTab ? 'var(--zen-3)' : 'var(--zen-4)' }}
        >
          {isNewTab ? 'home' : 'lock'}
        </span>
        <input
          className="drift-url-input"
          style={S.urlInput}
          value={barUrl}
          placeholder="Search or enter address"
          onChange={e => setBarUrl(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={e => { setBarUrl(activeTab?.url && !isNewTabUrl(activeTab.url) ? activeTab.url : ''); e.target.select() }}
          onBlur={() => setBarUrl(activeTab ? prettyUrl(activeTab.url) : '')}
          spellCheck={false}
        />
      </div>

      {/* Right — utility buttons */}
      <div style={S.navActions}>
        <button className="drift-nav-btn" style={S.navBtn} title="Bookmarks">
          <span className="material-symbols-outlined">bookmark_border</span>
        </button>
        <button className="drift-nav-btn" style={S.navBtn} title="Incognito">
          <span className="material-symbols-outlined">visibility_off</span>
        </button>
        <button className="drift-nav-btn" style={S.navBtn} title="Menu">
          <span className="material-symbols-outlined">more_vert</span>
        </button>
      </div>
    </nav>
  )
}, (p, n) =>
  p.activeTab?.id         === n.activeTab?.id         &&
  p.activeTab?.url        === n.activeTab?.url        &&
  p.activeTab?.isLoading  === n.activeTab?.isLoading  &&
  p.activeTab?.canGoBack  === n.activeTab?.canGoBack  &&
  p.activeTab?.canGoForward === n.activeTab?.canGoForward &&
  p.onNavigate === n.onNavigate &&
  p.onBack     === n.onBack     &&
  p.onForward  === n.onForward  &&
  p.onReload   === n.onReload,
)

/* ────────────────────────────────────────────────────────
   App — root component
──────────────────────────────────────────────────────── */
export default function App() {
  const [tabs, dispatch] = useReducer(tabReducer, [makeTab()])

  // Map of tabId → live WebviewTag element for imperative control
  const webviews = useRef<Map<string, WebviewTag>>(new Map())

  const activeTab = tabs.find(t => t.active)
  const showNewTab = !activeTab || isNewTabUrl(activeTab.url)

  /* ── Stable callbacks (never recreated) ─── */
  const handleTabUpdate = useCallback((id: string, patch: Partial<Tab>) => {
    dispatch({ type: 'PATCH', id, patch })
  }, [])

  const handleWebviewRef = useCallback((id: string, el: WebviewTag | null) => {
    if (el) webviews.current.set(id, el)
    else    webviews.current.delete(id)
  }, [])

  const handleNewWindow = useCallback((url: string) => {
    dispatch({ type: 'ADD', tab: makeTab(url) })
  }, [])

  /* ── Tab management ─── */
  const addTab    = useCallback(() => dispatch({ type: 'ADD',   tab: makeTab() }), [])
  const closeTab  = useCallback((id: string) => dispatch({ type: 'CLOSE',  id }), [])
  const switchTab = useCallback((id: string) => dispatch({ type: 'SWITCH', id }), [])

  /* ── Navigation ─── */
  const navigate = useCallback((input: string) => {
    if (!activeTab) return
    const url = parseInput(input)

    if (isNewTabUrl(url)) {
      // Navigate back to new-tab page
      dispatch({ type: 'PATCH', id: activeTab.id, patch: {
        url: NEW_TAB_URL, pendingUrl: '', title: 'New Tab', favicon: 'home',
        isLoading: false, canGoBack: false, canGoForward: false,
      }})
      return
    }

    if (isNewTabUrl(activeTab.url)) {
      // First real navigation for this tab — update url to mount the webview
      dispatch({ type: 'PATCH', id: activeTab.id, patch: { url, pendingUrl: url, isLoading: true } })
    } else {
      // Webview already exists — navigate imperatively (NO remount, NO re-render cost)
      const wv = webviews.current.get(activeTab.id)
      if (wv) {
        dispatch({ type: 'PATCH', id: activeTab.id, patch: { pendingUrl: url, isLoading: true } })
        wv.loadURL(url)
      }
    }
  }, [activeTab])

  const goBack    = useCallback(() => { if (activeTab) webviews.current.get(activeTab.id)?.goBack()    }, [activeTab])
  const goForward = useCallback(() => { if (activeTab) webviews.current.get(activeTab.id)?.goForward() }, [activeTab])
  const reload    = useCallback(() => {
    if (!activeTab) return
    const wv = webviews.current.get(activeTab.id)
    if (wv) { if (activeTab.isLoading) wv.stop(); else wv.reload() }
  }, [activeTab])

  return (
    <div style={S.root}>
      {/* ── Content area: new-tab dashboard OR webview ── */}
      <div style={S.contentArea}>
        {/* New-tab dashboard — visible when active tab has no URL */}
        <div style={{ ...S.newTabLayer, display: showNewTab ? 'block' : 'none' }}>
          <NewTabDashboard onNavigate={navigate} />
        </div>

        {/* Thin loading indicator at top of content */}
        <LoadingBar loading={!showNewTab && (activeTab?.isLoading ?? false)} />

        {/* All live webviews — only active one is display:flex */}
        <WebviewLayer
          tabs={tabs}
          onUpdate={handleTabUpdate}
          onRef={handleWebviewRef}
          onNewWindow={handleNewWindow}
        />
      </div>

      {/* ── Bottom floating chrome strip ── */}
      <div style={S.bottomStrip}>
        <TabBar tabs={tabs} onSelect={switchTab} onClose={closeTab} onNew={addTab} />
        <NavBar
          activeTab={activeTab}
          onNavigate={navigate}
          onBack={goBack}
          onForward={goForward}
          onReload={reload}
        />
      </div>
    </div>
  )
}

/* ────────────────────────────────────────────────────────
   Styles — all inline, zero external dependencies
──────────────────────────────────────────────────────── */
const S: Record<string, React.CSSProperties> = {
  root: {
    position: 'relative',
    width: '100vw',
    height: '100vh',
    overflow: 'hidden',
    fontFamily: 'var(--font-sans)',
    color: 'var(--zen-4)',
    background: '#F5EFE6',
  },

  /* Content area — fills the FULL viewport so webviews can use 100% height */
  contentArea: {
    position: 'absolute',
    inset: 0,
    overflow: 'hidden',
  },

  /* New-tab layer fills the content area */
  newTabLayer: {
    position: 'absolute',
    inset: 0,
    zIndex: 2,
    overflow: 'hidden',
  },

  /* Background image (inside newTabLayer) */
  bg: {
    position: 'absolute',
    inset: 0,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
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

  /* Greeting */
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

  /* Center dashboard */
  dashboard: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -60%)',
    zIndex: 5,
    width: '100%',
    maxWidth: 640,
    paddingInline: 24,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 36,
  },

  /* Search bar */
  searchWrapper: {
    width: '100%',
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
  },
  searchIcon: {
    position: 'absolute',
    left: 22,
    fontSize: 20,
    color: 'var(--zen-4)',
    opacity: 0.5,
    pointerEvents: 'none',
    zIndex: 1,
  },
  searchInput: {
    width: '100%',
    background: 'rgba(245,239,230,0.9)',
    border: '2px solid var(--zen-2)',
    borderRadius: 9999,
    padding: '14px 64px 14px 54px',
    fontSize: 17,
    fontWeight: 500,
    color: 'var(--zen-4)',
    fontFamily: 'var(--font-sans)',
    transition: 'border-color 200ms, box-shadow 200ms',
  },
  searchBrand: {
    position: 'absolute',
    right: 22,
    fontSize: 12,
    fontFamily: 'var(--font-mono)',
    color: 'var(--zen-4)',
    opacity: 0.35,
    letterSpacing: '0.04em',
    pointerEvents: 'none',
  },

  /* Shortcuts */
  shortcuts: {
    display: 'flex',
    gap: 28,
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
    background: 'var(--zen-2)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 18,
    fontWeight: 600,
    color: 'var(--zen-4)',
    transition: 'background 180ms, transform 180ms',
  },
  shortcutLabel: { fontSize: 13, color: 'var(--zen-4)', fontWeight: 400 },

  /* Widgets — raised above the floating bottom strip (~160px tall + 16px gap + 16px margin) */
  widgets: {
    position: 'absolute',
    bottom: 200,
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
    padding: '7px 16px',
    color: 'var(--zen-4)',
    cursor: 'pointer',
    transition: 'border-color 200ms',
    fontFamily: 'var(--font-sans)',
  },
  widgetMono:  { fontFamily: 'var(--font-mono)', fontSize: 12 },
  widgetLabel: { fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', opacity: 0.6 },
  weatherWidget: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    background: 'rgba(232,223,202,0.85)',
    borderRadius: 9999,
    padding: '7px 16px',
    color: 'var(--zen-4)',
    fontFamily: 'var(--font-mono)',
    fontSize: 12,
  },

  /* Loading bar */
  loadingTrack: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    zIndex: 100,
    background: 'transparent',
    overflow: 'hidden',
  },
  loadingBar: {
    height: '100%',
    background: 'var(--zen-4)',
    animation: 'drift-loading 1.4s ease-in-out infinite',
  },

  /* Bottom strip — transparent spacer; individual bars float as pills */
  bottomStrip: {
    position: 'fixed',
    bottom: 14,
    left: 14,
    right: 14,
    zIndex: 500,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    padding: '0',
    gap: 6,
    background: 'transparent',
  },

  /* Tab bar */
  tabBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    width: '100%',
    overflowX: 'auto',
    paddingInline: 4,
  },
  tab: {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    borderRadius: 9999,
    padding: '6px 12px',
    minWidth: 140,
    maxWidth: 210,
    cursor: 'pointer',
    transition: 'background 200ms',
    flexShrink: 0,
    userSelect: 'none',
  },
  tabTitle: {
    fontSize: 12,
    fontWeight: 400,
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  tabClose: {
    opacity: 0,
    marginLeft: 2,
    borderRadius: 9999,
    padding: 2,
    color: 'inherit',
    transition: 'opacity 120ms',
    cursor: 'pointer',
    flexShrink: 0,
  },
  newTabBtn: {
    width: 34,
    height: 34,
    borderRadius: 9999,
    background: 'var(--zen-2)',
    color: 'var(--zen-4)',
    flexShrink: 0,
    marginLeft: 2,
    transition: 'background 180ms',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* Nav bar */
  navBar: {
    display: 'flex',
    alignItems: 'center',
    background: 'rgba(232,223,210,0.8)',
    color: 'var(--zen-4)',
    borderRadius: 9999,
    padding: '7px 16px',
    width: '100%',
    gap: 0,
  },
  navActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  navBtn: {
    color: 'var(--zen-4)',
    borderRadius: 9999,
    padding: 5,
    transition: 'color 120ms, background 120ms',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  urlBarWrapper: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginInline: 16,
    background: 'rgba(245,239,230,0.75)',
    borderRadius: 9999,
    padding: '5px 12px 5px 10px',
    minWidth: 0,
  },
  urlLock: {
    fontSize: 15,
    opacity: 0.5,
    flexShrink: 0,
    transition: 'color 200ms',
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
