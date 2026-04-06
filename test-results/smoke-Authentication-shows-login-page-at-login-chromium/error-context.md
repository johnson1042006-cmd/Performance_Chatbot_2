# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: smoke.spec.ts >> Authentication >> shows login page at /login
- Location: e2e/smoke.spec.ts:15:7

# Error details

```
Error: browserType.launch: Target page, context or browser has been closed
Browser logs:

<launching> /var/folders/yz/spvrgmyx28l1vjyxcs3lctzc0000gn/T/cursor-sandbox-cache/996dc0eb002dc0bef6fc07723b73009b/playwright/chromium_headless_shell-1217/chrome-headless-shell-mac-x64/chrome-headless-shell --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,Translate,AutoDeElevate,RenderDocument,OptimizationHints --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --enable-automation --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/yz/spvrgmyx28l1vjyxcs3lctzc0000gn/T/playwright_chromiumdev_profile-vNmLqG --remote-debugging-pipe --no-startup-window
<launched> pid=21310
[pid=21310][err] Received signal 11 SEGV_MAPERR 000000000010
[pid=21310][err]  [0x0001062cc2c3]
[pid=21310][err]  [0x0001062d0103]
[pid=21310][err]  [0x7ff81b40731d]
[pid=21310][err]  [0x00000000010b]
[pid=21310][err]  [0x000102f7e065]
[pid=21310][err]  [0x000102941061]
[pid=21310][err]  [0x000102b57176]
[pid=21310][err]  [0x0001042ef9b2]
[pid=21310][err]  [0x0001042f09dc]
[pid=21310][err]  [0x00020b2f5530]
[pid=21310][err] [end of stack trace]
Call log:
  - <launching> /var/folders/yz/spvrgmyx28l1vjyxcs3lctzc0000gn/T/cursor-sandbox-cache/996dc0eb002dc0bef6fc07723b73009b/playwright/chromium_headless_shell-1217/chrome-headless-shell-mac-x64/chrome-headless-shell --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,Translate,AutoDeElevate,RenderDocument,OptimizationHints --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --enable-automation --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/yz/spvrgmyx28l1vjyxcs3lctzc0000gn/T/playwright_chromiumdev_profile-vNmLqG --remote-debugging-pipe --no-startup-window
  - <launched> pid=21310
  - [pid=21310][err] Received signal 11 SEGV_MAPERR 000000000010
  - [pid=21310][err]  [0x0001062cc2c3]
  - [pid=21310][err]  [0x0001062d0103]
  - [pid=21310][err]  [0x7ff81b40731d]
  - [pid=21310][err]  [0x00000000010b]
  - [pid=21310][err]  [0x000102f7e065]
  - [pid=21310][err]  [0x000102941061]
  - [pid=21310][err]  [0x000102b57176]
  - [pid=21310][err]  [0x0001042ef9b2]
  - [pid=21310][err]  [0x0001042f09dc]
  - [pid=21310][err]  [0x00020b2f5530]
  - [pid=21310][err] [end of stack trace]
  - [pid=21310] <gracefully close start>
  - [pid=21310] <kill>
  - [pid=21310] <will force kill>
  - [pid=21310] exception while trying to kill process: Error: kill ESRCH
  - [pid=21310] <process did exit: exitCode=null, signal=SIGSEGV>
  - [pid=21310] starting temporary directories cleanup
  - [pid=21310] finished temporary directories cleanup
  - [pid=21310] <gracefully close end>

```