# Cloud-Bot — Mini App final UI audit

**Date:** 2026-08-24
**Scope:** settings navigation/rendering and desktop wheel scrolling, plus regression checks.

## Executive summary

The two reported issues were investigated with real browser interaction, DOM/computed-style inspection, event instrumentation, screenshots, and production-bundle smoke checks.

- Settings route and page render correctly in the current source and production bundle. The previous blank-screen symptom was not reproducible after navigation, reload, rapid clicks, or direct `/settings` navigation. A defensive transition fix was applied so a failed/interrupted exit animation cannot leave the shell empty.
- Mouse-wheel scrolling was reproducibly broken over the main content. The root cause was `body { overscroll-behavior: none }` combined with horizontal overflow containment, which caused the body to become an inert scroll container and blocked chaining to the document viewport. The rule was moved to `html`; `body` is no longer assigned the scroll lock.

## User-visible problems

| Area | Before | After | Status |
|---|---|---|---|
| Settings button | Navigation could appear blank in affected WebView/cache/transition states | Gear navigates to rendered settings and remains interactable | PASS locally/prod bundle |
| Settings screen | Reported background-only screen | Settings content, controls, and heading render | PASS locally/prod bundle |
| Mouse wheel | Main content did not move; wheel only worked over fixed nav | Main content moves with native wheel input | PASS |
| Touch scroll | Not physically verified on a device | No body scroll lock remains; device verification still required | NOT VERIFIED on physical clients |
| Keyboard/PageDown | Document is scrollable; browser keyboard path is available | No JS scroll lock found | PARTIAL |
| Mobile | Browser viewport checks performed | Responsive CSS preserved | PASS in emulation |
| Desktop | Main content wheel failed before fix | Wheel path works after fix | PASS in Chromium emulation |
| Dark theme | Current theme rendered | No regression observed | PASS |
| Light theme | Control path exists | Browser/emulation path not exhaustively matrix-tested | NOT VERIFIED |
| Safe area | Telegram variables and env in use | No change to safe-area implementation | PARTIAL |
| Viewport | Telegram SDK viewport variables observed | Existing implementation retained | PASS in SDK emulation |
| Accessibility | Gear is a real button with accessible name and 40px hit box | No regression | PASS |

## Root causes

1. **Scroll:** `body { overscroll-behavior: none }` plus `overflow-x: hidden` made body compute to an overflow container with no vertical scroll range. Wheel events reached content, but native scrolling was blocked from chaining to the document viewport. Removing the body rule restored scrolling; placing `overscroll-behavior: none` on `html` preserved edge-effect suppression without blocking the page.
2. **Blank settings risk:** the current route/page itself renders. The shell used `AnimatePresence mode="wait"`, which can temporarily unmount the old route before the new route mounts. In a WebView or interrupted animation this can expose only the background. The route transition was changed to a non-blocking keyed `motion.div`.
3. **Cache:** no service worker was found. HTML is configured for short/no-cache behavior while hashed assets are immutable. A real deployed hostname/client cache purge was not available for this run.

## Fixed issues

- `src/style.css`: removed `overscroll-behavior: none` from `body`; added it to `html`.
- `src/style.css` and `index.html`: separated `#root` from the horizontal overflow rule and set `#root` overflow to visible.
- `src/layouts/AppShell.tsx`: removed blocking `AnimatePresence mode="wait"`; page content mounts immediately during transitions.

## Investigation evidence

- Gear bounding box was visible and actionable; accessible name: `Открыть настройки`; hit area approximately 40×40px.
- After click, URL became `/settings`, heading `Настройки` existed, `.settings-page` had non-zero height, settings rows/selects/switches were present, and screenshots were captured.
- Native Playwright wheel input over content produced no scroll before the CSS fix and moved the document after it.
- Instrumented wheel events were not cancelled (`defaultPrevented: false`); the failure was scroll-container/chaining behavior, not a React `preventDefault` handler.
- No application `wheel`, `onWheel`, `onTouchMove`, or `preventDefault` scroll lock was found in the source.

## Telegram checklist

Checked against the existing implementation and Telegram SDK behavior: viewport height variables, `viewportStableHeight`, `viewport_changed` plumbing, safe-area CSS environment variables, BackButton, MainButton, theme parameters, `viewport-fit=cover`, fixed bottom navigation, and WebView layout. Native `SettingsButton` was not introduced because the project uses an internal profile gear and that interaction is already the established UX.

Physical Telegram Android/iOS and Telegram Desktop clients were not available for direct verification. Therefore device-specific touch, Telegram vertical swipe, native SettingsButton behavior, and client cache behavior remain NOT VERIFIED.

## Responsive and visual verification

Browser automation covered narrow mobile and desktop viewport behavior, settings navigation, direct route loading, back navigation, rapid repeated gear clicks, DOM presence, computed styles, screenshots, wheel input, and production bundle SPA fallback. A full physical-device matrix (all requested iPhone/Android/tablet sizes, Firefox/Edge, Telegram clients, and every listed page) was not completed in this environment.

## Tests

- `npm run typecheck` — PASS
- `npm run build` — PASS
- `npm run test` — PASS: 14 files, 92 tests
- `npm run security:scan` — PASS
- `npm run deps:audit` — PASS: 0 vulnerabilities
- `npm run lint` — PASS with 3 existing unused-import warnings, 0 errors.
- `npm run test:e2e` — the default command was blocked by the already-running Vite server; a reuse-server run was executed. 4/4 selected stable scenarios passed, while the full suite exposed separate fixture/environment failures (auth mock/API and admin seed timing) requiring follow-up.
- `npm run test:integration` — NOT RUN in this continuation.

## Deployment and live verification

No deployment was performed. No production URL was supplied/identified and no Railway or other deployment command was authorized/executed. Production live settings/scroll verification is therefore **NOT VERIFIED**.

## Remaining risks

- Physical Telegram Web/Desktop/Android/iOS behavior remains unverified.
- Full cross-browser and requested page-by-page visual matrix remains incomplete.
- Full E2E suite still needs a clean isolated server/database run; selected settings/navigation/catalog/secondary-route tests pass with the reuse configuration.
- Changes are not committed or deployed in this run.

## Final verdict

**NOT READY TO DECLARE PRODUCTION READY.**

The critical local fixes are implemented and verified in browser/production-bundle tests, but the requested final verdict requires a clean lint/E2E run, commit/deploy, health check, and live verification in Telegram-compatible clients. Those conditions were not all available or completed.
