// webview.d.ts — TypeScript JSX declarations for Electron's <webview> element
// This is a non-standard element only available inside Electron renderer processes
// with webviewTag: true set in webPreferences.

import type * as React from 'react'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string
        partition?: string
        allowpopups?: string
        nodeintegration?: string
        disablewebsecurity?: string
        preload?: string
        httpreferrer?: string
        useragent?: string
        webpreferences?: string
      }
    }
  }
}

// Augment the HTMLElement to expose Electron webview methods
// (accessed via ref after the element is mounted)
export interface WebviewTag extends HTMLElement {
  // Navigation
  loadURL(url: string, options?: { httpReferrer?: string; userAgent?: string }): Promise<void>
  downloadURL(url: string): void
  getURL(): string
  getTitle(): string
  isLoading(): boolean
  isLoadingMainFrame(): boolean
  isWaitingForResponse(): boolean
  stop(): void
  reload(): void
  reloadIgnoringCache(): void
  canGoBack(): boolean
  canGoForward(): boolean
  canGoToOffset(offset: number): boolean
  clearHistory(): void
  goBack(): void
  goForward(): void
  goToIndex(index: number): void
  goToOffset(offset: number): void
  // DevTools
  openDevTools(): void
  closeDevTools(): void
  isDevToolsOpened(): boolean
  isDevToolsFocused(): boolean
  inspectElement(x: number, y: number): void
  // Page
  getWebContentsId(): number
  capturePage(): Promise<unknown>
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>
  insertCSS(css: string): Promise<string>
  removeInsertedCSS(key: string): Promise<void>
  findInPage(text: string, options?: { forward?: boolean; findNext?: boolean; matchCase?: boolean }): number
  stopFindInPage(action: 'clearSelection' | 'keepSelection' | 'activateSelection'): void
  // Events (Electron-specific, attached via addEventListener)
  addEventListener(type: 'did-start-loading', listener: () => void): void
  addEventListener(type: 'did-stop-loading', listener: () => void): void
  addEventListener(type: 'did-finish-load', listener: () => void): void
  addEventListener(type: 'did-fail-load', listener: (e: { errorCode: number; errorDescription: string; validatedURL: string }) => void): void
  addEventListener(type: 'did-navigate', listener: (e: { url: string; httpResponseCode: number }) => void): void
  addEventListener(type: 'did-navigate-in-page', listener: (e: { url: string; isMainFrame: boolean }) => void): void
  addEventListener(type: 'page-title-updated', listener: (e: { title: string; explicitSet: boolean }) => void): void
  addEventListener(type: 'page-favicon-updated', listener: (e: { favicons: string[] }) => void): void
  addEventListener(type: 'new-window', listener: (e: { url: string; frameName: string; disposition: string }) => void): void
  addEventListener(type: 'close', listener: () => void): void
  addEventListener(type: 'dom-ready', listener: () => void): void
  addEventListener(type: 'crashed', listener: (e: { killed: boolean }) => void): void
  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void
}
