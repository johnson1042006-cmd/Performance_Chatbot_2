# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: bot-quality.spec.ts >> Bot quality — 50 questions across the catalog >> answers across helmets, apparel, parts, accessories, and policy
- Location: e2e/bot-quality.spec.ts:479:7

# Error details

```
Error: Channel closed
```

```
Error: page.goto: Target page, context or browser has been closed
```

```
Error: browserContext.close: Test ended.
Browser logs:

<launching> /var/folders/yz/spvrgmyx28l1vjyxcs3lctzc0000gn/T/cursor-sandbox-cache/1a3e02dcbfb7aac3658621242cf18671/playwright/chromium_headless_shell-1217/chrome-headless-shell-mac-arm64/chrome-headless-shell --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,Translate,AutoDeElevate,RenderDocument,OptimizationHints --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --enable-automation --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/yz/spvrgmyx28l1vjyxcs3lctzc0000gn/T/playwright_chromiumdev_profile-MngAu3 --remote-debugging-pipe --no-startup-window
<launched> pid=80430
[pid=80430][err] [0502/132536.964434:INFO:CONSOLE:29890] "%cDownload the React DevTools for a better development experience: https://reactjs.org/link/react-devtools font-weight:bold", source: webpack-internal:///./node_modules/react-dom/cjs/react-dom.development.js (29890)
[pid=80430][err] [0502/132536.996494:INFO:CONSOLE:625] "Uncaught Error: Invariant: missing bootstrap script. This is a bug in Next.js", source: webpack-internal:///./node_modules/next/dist/client/index.js (625)
[pid=80430][err] [0502/132536.999431:INFO:CONSOLE:39] "[HMR] connected", source: webpack-internal:///./node_modules/next/dist/client/components/react-dev-overlay/pages/websocket.js (39)
[pid=80430][err] [0502/133531.728497:INFO:CONSOLE:39] "[HMR] connected", source: webpack-internal:///./node_modules/next/dist/client/components/react-dev-overlay/pages/websocket.js (39)
[pid=80430][err] [0502/133531.781971:INFO:CONSOLE:350] "[Fast Refresh] performing full reload because your application had an unrecoverable error", source: webpack-internal:///./node_modules/next/dist/client/components/react-dev-overlay/pages/hot-reloader-client.js (350)
[pid=80430][err] [0502/133539.829896:WARNING:net/dns/dns_config_service_posix.cc:197] Failed to read DnsConfig.
[pid=80430][err] [0502/133539.830093:WARNING:net/dns/dns_config_service_posix.cc:197] Failed to read DnsConfig.
[pid=80430][err] [0502/133544.424920:WARNING:net/dns/dns_config_service_posix.cc:197] Failed to read DnsConfig.
[pid=80430][err] [0502/133544.425057:WARNING:net/dns/dns_config_service_posix.cc:197] Failed to read DnsConfig.
[pid=80430][err] [0502/133601.681030:WARNING:net/dns/dns_config_service_posix.cc:197] Failed to read DnsConfig.
[pid=80430][err] [0502/133601.681053:WARNING:net/dns/dns_config_service_posix.cc:197] Failed to read DnsConfig.
[pid=80430][err] [0502/133605.811795:WARNING:net/dns/dns_config_service_posix.cc:197] Failed to read DnsConfig.
[pid=80430][err] [0502/133605.811912:WARNING:net/dns/dns_config_service_posix.cc:197] Failed to read DnsConfig.
[pid=80430] <gracefully close start>
```