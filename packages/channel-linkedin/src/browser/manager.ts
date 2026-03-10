/**
 * BrowserManager — Chromium lifecycle management for LinkedIn automation.
 *
 * Ported from linkedin-agent/scan_raw.py launch_persistent_context() pattern.
 * Uses Playwright's persistent context to preserve LinkedIn session cookies
 * across restarts.
 *
 * Key design decisions (from linkedin-agent):
 * - Persistent user data dir keeps session cookies alive
 * - headless: true for server deployment
 * - viewport: 1280x900 (same as linkedin-agent)
 * - locale: 'pt-BR' (same as linkedin-agent)
 * - Navigation retry: 3 attempts with 2s backoff (scan_raw.py lines 14-24)
 */

import { chromium } from 'playwright';
import type { BrowserContext, Page } from 'playwright';
import { NAV_RETRY_ATTEMPTS, NAV_RETRY_DELAY, exactDelay, humanDelay } from './humanizer';

// ---------------------------------------------------------------------------
// Default browser configuration (from linkedin-agent)
// ---------------------------------------------------------------------------

export interface BrowserConfig {
  /** Path to persistent Chromium user data directory */
  browserDataPath: string;
  /** Run in headless mode (default: true) — scan_raw.py: headless=True */
  headless?: boolean;
  /** Viewport width (default: 1280) — scan_raw.py: width=1280 */
  viewportWidth?: number;
  /** Viewport height (default: 900) — scan_raw.py: height=900 */
  viewportHeight?: number;
  /** Browser locale (default: 'pt-BR') — scan_raw.py: locale='pt-BR' */
  locale?: string;
}

const DEFAULTS: Required<Omit<BrowserConfig, 'browserDataPath'>> = {
  headless: true,
  viewportWidth: 1280,
  viewportHeight: 900,
  locale: 'pt-BR',
};

// ---------------------------------------------------------------------------
// LinkedIn URLs
// ---------------------------------------------------------------------------

const LINKEDIN_MESSAGING_URL = 'https://www.linkedin.com/messaging/';
const LINKEDIN_FEED_URL = 'https://www.linkedin.com/feed/';

// ---------------------------------------------------------------------------
// BrowserManager
// ---------------------------------------------------------------------------

export class BrowserManager {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private readonly config: Required<BrowserConfig>;

  constructor(config: BrowserConfig) {
    this.config = {
      ...DEFAULTS,
      ...config,
    } as Required<BrowserConfig>;
  }

  /**
   * Launch a persistent Chromium context.
   * Ported from scan_raw.py: p.chromium.launch_persistent_context(...)
   *
   * Uses persistent user data dir so LinkedIn session cookies survive restarts.
   * If pages already exist in the context (restored session), reuses the first.
   * Otherwise creates a new page — same pattern as scan_raw.py line 67.
   */
  async launch(): Promise<void> {
    if (this.context) {
      throw new Error('Browser already launched. Call close() first.');
    }

    this.context = await chromium.launchPersistentContext(this.config.browserDataPath, {
      headless: this.config.headless,
      viewport: {
        width: this.config.viewportWidth,
        height: this.config.viewportHeight,
      },
      locale: this.config.locale,
    });

    // Reuse existing page or create new one — scan_raw.py line 67
    const pages = this.context.pages();
    this.page = pages.length > 0 ? (pages[0] as Page) : await this.context.newPage();
  }

  /**
   * Navigate to LinkedIn Messaging with retry.
   * Ported from scan_raw.py goto_messaging() — lines 14-24.
   *
   * 3 attempts, 2s backoff between retries.
   * Uses 'domcontentloaded' wait strategy (not 'load') for faster navigation.
   *
   * @throws Error if all retry attempts fail
   */
  async navigateToMessaging(): Promise<void> {
    const page = this.requirePage();

    for (let attempt = 0; attempt < NAV_RETRY_ATTEMPTS; attempt++) {
      try {
        await page.goto(LINKEDIN_MESSAGING_URL, {
          waitUntil: 'domcontentloaded',
        });
        // scan_raw.py: page.wait_for_timeout(3000) after navigation
        await humanDelay('navigation');
        return;
      } catch (error) {
        const _message = error instanceof Error ? error.message : String(error);
        if (attempt < NAV_RETRY_ATTEMPTS - 1) {
          await exactDelay(NAV_RETRY_DELAY);
        }
      }
    }

    throw new Error(`Failed to navigate to LinkedIn Messaging after ${NAV_RETRY_ATTEMPTS} attempts`);
  }

  /**
   * Navigate to LinkedIn Feed.
   * Same retry pattern as navigateToMessaging().
   *
   * @throws Error if all retry attempts fail
   */
  async navigateToFeed(): Promise<void> {
    const page = this.requirePage();

    for (let attempt = 0; attempt < NAV_RETRY_ATTEMPTS; attempt++) {
      try {
        await page.goto(LINKEDIN_FEED_URL, {
          waitUntil: 'domcontentloaded',
        });
        await humanDelay('navigation');
        return;
      } catch (error) {
        const _message = error instanceof Error ? error.message : String(error);
        if (attempt < NAV_RETRY_ATTEMPTS - 1) {
          await exactDelay(NAV_RETRY_DELAY);
        }
      }
    }

    throw new Error(`Failed to navigate to LinkedIn Feed after ${NAV_RETRY_ATTEMPTS} attempts`);
  }

  /**
   * Get the current Playwright Page instance.
   *
   * @throws Error if browser not launched
   */
  getPage(): Page {
    return this.requirePage();
  }

  /**
   * Check if the browser is still connected and the page is usable.
   */
  isConnected(): boolean {
    if (!this.context || !this.page) return false;
    try {
      // Check if the page is still open (not closed)
      return !this.page.isClosed();
    } catch {
      return false;
    }
  }

  /**
   * Check if the LinkedIn session is authenticated.
   * Ported from scan_raw.py lines 74-77: checks URL for 'login' or 'checkpoint'.
   *
   * @returns true if the page URL does not indicate a login/checkpoint redirect
   */
  isAuthenticated(): boolean {
    if (!this.page || this.page.isClosed()) return false;
    const url = this.page.url();
    return !url.includes('login') && !url.includes('checkpoint');
  }

  /**
   * Close the browser context and release resources.
   * Ported from scan_raw.py: context.close()
   */
  async close(): Promise<void> {
    if (this.context) {
      try {
        await this.context.close();
      } catch {
        // Context may already be closed
      }
      this.context = null;
      this.page = null;
    }
  }

  /**
   * Internal: ensure page is available or throw.
   */
  private requirePage(): Page {
    if (!this.page || this.page.isClosed()) {
      throw new Error('Browser not launched or page closed. Call launch() first.');
    }
    return this.page;
  }
}
