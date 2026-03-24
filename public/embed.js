(function () {
  var PC_CHAT_URL = "https://performance-chatbot-2.vercel.app";

  var path = window.location.pathname.toLowerCase();
  var excludedPaths = ["/checkout", "/finishorder", "/order-confirmation", "/manage-account/payment"];
  for (var i = 0; i < excludedPaths.length; i++) {
    if (path.indexOf(excludedPaths[i]) === 0) return;
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

  var sessionId = localStorage.getItem("pc_chat_session") || generateId();
  localStorage.setItem("pc_chat_session", sessionId);

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

  var open = false;
  bubble.addEventListener("click", function () {
    open = !open;
    iframe.classList.toggle("open", open);
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
      open = false;
      iframe.classList.remove("open");
    }
  });
})();
