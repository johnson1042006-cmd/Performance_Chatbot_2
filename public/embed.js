(function () {
  // Base URL for the Next app (iframe + `/api/embed/config`). Prefer the
  // origin of *this* script so local `widget-test.html` (which loads
  // `/embed.js` from the dev server) talks to `http://localhost:3000` instead
  // of a hardcoded production host — otherwise `fetch(PC_CHAT_URL + ...)` hits
  // CORS from localhost. Production: keep using the full script URL in the
  // storefront tag, e.g. `https://your-app.vercel.app/embed.js`.
  var PC_CHAT_DEFAULT = "https://performance-chatbot2-2.vercel.app";
  var PC_CHAT_URL = PC_CHAT_DEFAULT;
  try {
    var cs = document.currentScript;
    if (cs && cs.src) {
      PC_CHAT_URL = new URL(cs.src).origin;
    } else {
      var nodes = document.querySelectorAll('script[src*="embed.js"]');
      if (nodes.length) {
        var el = nodes[nodes.length - 1];
        if (el.src) PC_CHAT_URL = new URL(el.src).origin;
      }
    }
  } catch (e) {
    PC_CHAT_URL = PC_CHAT_DEFAULT;
  }

  // Pages where the chat bubble is suppressed entirely. Checkout-flow
  // pages get no widget at all so the iframe never competes with the cart.
  var path = window.location.pathname.toLowerCase();
  var excludedPaths = ["/checkout", "/finishorder", "/order-confirmation", "/manage-account/payment"];
  for (var i = 0; i < excludedPaths.length; i++) {
    if (path.indexOf(excludedPaths[i]) === 0) return;
  }

  // Auto-open is suppressed on a wider set of paths than the bubble itself.
  // The whole /manage-account section feels intrusive to auto-open, but the
  // bubble is still useful (e.g. on /manage-account/orders).
  var autoOpenExcludes = [
    "/checkout",
    "/finishorder",
    "/order-confirmation",
    "/manage-account/",
  ];
  function shouldSuppressAutoOpen() {
    for (var j = 0; j < autoOpenExcludes.length; j++) {
      if (path.indexOf(autoOpenExcludes[j]) === 0) return true;
    }
    return false;
  }

  var style = document.createElement("style");
  style.textContent =
    "#pc-chat-bubble{position:fixed;bottom:20px;right:20px;width:60px;height:60px;border-radius:50%;background:#e63946;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(0,0,0,0.15);z-index:9999;transition:transform 0.2s}" +
    "#pc-chat-bubble:hover{transform:scale(1.05)}" +
    "#pc-chat-bubble svg{width:28px;height:28px;fill:white}" +
    "#pc-chat-frame{position:fixed;bottom:90px;right:20px;width:380px;height:560px;border:none;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.15);z-index:9999;display:none;overflow:hidden}" +
    "#pc-chat-frame.open{display:block}" +
    "@media(max-width:480px){#pc-chat-frame{width:calc(100vw - 20px);right:10px;bottom:80px;height:min(500px,70vh)}}";
  document.head.appendChild(style);

  var sessionId;
  try {
    sessionId = localStorage.getItem("pc_chat_session") || generateId();
    localStorage.setItem("pc_chat_session", sessionId);
  } catch (e) {
    sessionId = generateId();
  }

  function generateId() {
    return "s_" + Math.random().toString(36).substr(2, 12) + Date.now().toString(36);
  }

  function getPageContext() {
    var ctx = {
      url: window.location.href,
      pageType: "other",
      productName: null,
      productSku: null,
      categoryName: null,
      searchQuery: null,
    };

    var p = window.location.pathname;

    if (typeof window.BCData !== "undefined" && window.BCData.product_attributes) {
      ctx.pageType = "product";
      ctx.productName = window.BCData.product_attributes.name || null;
      ctx.productSku = window.BCData.product_attributes.sku || null;
    } else if (p === "/" || p === "") {
      ctx.pageType = "home";
    } else if (p.includes("/cart")) {
      ctx.pageType = "cart";
    } else if (p.includes("/search")) {
      ctx.pageType = "search";
      var params = new URLSearchParams(window.location.search);
      ctx.searchQuery = params.get("search_query") || params.get("q") || null;
    } else if (p.includes("/categories/") || p.includes("/category/")) {
      ctx.pageType = "category";
    }

    var productTitle = document.querySelector("h1.productView-title, h1[data-product-title], .productView-title");
    if (productTitle && !ctx.productName) {
      ctx.productName = productTitle.textContent.trim();
      ctx.pageType = "product";
    }

    var skuEl = document.querySelector("[data-product-sku], .productView-info-value--sku");
    if (skuEl && !ctx.productSku) {
      ctx.productSku = skuEl.textContent.trim();
    }

    var categoryHeader = document.querySelector("h1.page-heading, .page-heading");
    if (ctx.pageType === "category" && categoryHeader) {
      ctx.categoryName = categoryHeader.textContent.trim();
    }

    return ctx;
  }

  var bubble = document.createElement("div");
  bubble.id = "pc-chat-bubble";
  bubble.innerHTML =
    '<svg viewBox="0 0 24 24"><path d="M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>';
  document.body.appendChild(bubble);

  var iframe = document.createElement("iframe");
  iframe.id = "pc-chat-frame";
  iframe.src = PC_CHAT_URL + "/embed?sessionId=" + sessionId;
  document.body.appendChild(iframe);

  iframe.addEventListener("load", function () {
    var ctx = getPageContext();
    iframe.contentWindow.postMessage(
      { type: "pc-page-context", context: ctx },
      "*"
    );
  });

  var lastPath = window.location.pathname;
  setInterval(function () {
    if (window.location.pathname !== lastPath) {
      lastPath = window.location.pathname;
      var newCtx = getPageContext();
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage(
          { type: "pc-page-context", context: newCtx },
          "*"
        );
      }
    }
  }, 1000);

  var open = false;
  function setOpen(next) {
    open = !!next;
    iframe.classList.toggle("open", open);
  }
  bubble.addEventListener("click", function () {
    setOpen(!open);
  });

  window.addEventListener("message", function (event) {
    if (event.data && event.data.type === "pc-chat-send") {
      var ctx = getPageContext();
      iframe.contentWindow.postMessage(
        { type: "pc-page-context", context: ctx },
        "*"
      );
    }
    if (event.data && event.data.type === "pc-chat-close") {
      setOpen(false);
    }
  });

  // Best-effort auto-open on first visit. Failures (offline, CORS, 5xx) are
  // silent — the bubble is still clickable. We track the once-per-session
  // marker BEFORE the await so racing tabs don't both pop the iframe.
  function maybeAutoOpen() {
    if (shouldSuppressAutoOpen()) return;
    var alreadyOpened;
    try {
      alreadyOpened = sessionStorage.getItem("pc-chat-opened-once") === "1";
    } catch (e) {
      alreadyOpened = false;
    }
    if (alreadyOpened) return;

    fetch(PC_CHAT_URL + "/api/embed/config", { credentials: "omit" })
      .then(function (res) {
        if (!res.ok) return null;
        return res.json();
      })
      .then(function (cfg) {
        if (!cfg || cfg.autoOpenOnFirstVisit === false) return;
        try {
          sessionStorage.setItem("pc-chat-opened-once", "1");
        } catch (e) {
          // Storage disabled / private mode — open once per page load instead.
        }
        setOpen(true);
      })
      .catch(function () {
        // network blip — leave the bubble closed; the user can still open it
      });
  }
  maybeAutoOpen();
})();
