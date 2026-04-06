(function () {
  var PC_FBT_URL = "https://performance-chatbot-2.vercel.app";

  var TYPE_LABELS = {
    matching_pants: "Matching Pants",
    matching_jacket: "Matching Jacket",
    accessory: "Recommended Accessory",
    frequently_bought: "Frequently Bought Together",
  };

  function getProductSku() {
    if (typeof window.BCData !== "undefined" && window.BCData.product_attributes) {
      return window.BCData.product_attributes.sku || null;
    }

    var skuEl = document.querySelector(
      "[data-product-sku], .productView-info-value--sku"
    );
    if (skuEl) {
      return skuEl.textContent.trim() || null;
    }

    return null;
  }

  function isProductPage() {
    if (typeof window.BCData !== "undefined" && window.BCData.product_attributes) {
      return true;
    }
    if (
      document.querySelector(
        "h1.productView-title, h1[data-product-title], .productView-title"
      )
    ) {
      return true;
    }
    return false;
  }

  function formatPrice(price) {
    if (price == null) return "";
    return "$" + Number(price).toFixed(2);
  }

  function injectStyles() {
    var css =
      "#pc-fbt-section *{box-sizing:border-box;margin:0;padding:0}" +
      "#pc-fbt-section{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:100%;margin:32px 0;padding:0}" +
      "#pc-fbt-section .pc-fbt-title{font-size:20px;font-weight:700;color:#1a1a1a;margin-bottom:16px;display:flex;align-items:center;gap:8px}" +
      "#pc-fbt-section .pc-fbt-title svg{flex-shrink:0}" +
      "#pc-fbt-section .pc-fbt-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px}" +
      "#pc-fbt-section .pc-fbt-card{background:#fff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;transition:box-shadow 0.2s,transform 0.2s;display:flex;flex-direction:column}" +
      "#pc-fbt-section .pc-fbt-card:hover{box-shadow:0 4px 16px rgba(0,0,0,0.10);transform:translateY(-2px)}" +
      "#pc-fbt-section .pc-fbt-card-img{width:100%;aspect-ratio:1/1;object-fit:contain;background:#f9fafb;padding:12px}" +
      "#pc-fbt-section .pc-fbt-card-img-placeholder{width:100%;aspect-ratio:1/1;background:#f3f4f6;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:13px}" +
      "#pc-fbt-section .pc-fbt-card-body{padding:12px 14px 14px;flex:1;display:flex;flex-direction:column}" +
      "#pc-fbt-section .pc-fbt-badge{display:inline-block;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;padding:2px 8px;border-radius:99px;background:#eff6ff;color:#2563eb;margin-bottom:6px;width:fit-content}" +
      "#pc-fbt-section .pc-fbt-badge--accessory{background:#f0fdf4;color:#16a34a}" +
      "#pc-fbt-section .pc-fbt-badge--frequently_bought{background:#fef3c7;color:#d97706}" +
      "#pc-fbt-section .pc-fbt-card-name{font-size:14px;font-weight:600;color:#1a1a1a;line-height:1.3;margin-bottom:6px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}" +
      "#pc-fbt-section .pc-fbt-card-sku{font-size:11px;color:#9ca3af;font-family:monospace;margin-bottom:8px}" +
      "#pc-fbt-section .pc-fbt-card-price{font-size:16px;font-weight:700;color:#e63946;margin-top:auto;margin-bottom:10px}" +
      "#pc-fbt-section .pc-fbt-card-price .pc-fbt-original{font-size:13px;color:#9ca3af;text-decoration:line-through;margin-left:6px;font-weight:400}" +
      "#pc-fbt-section .pc-fbt-card-link{display:block;text-align:center;padding:8px 12px;background:#e63946;color:#fff;font-size:13px;font-weight:600;border-radius:6px;text-decoration:none;transition:background 0.15s}" +
      "#pc-fbt-section .pc-fbt-card-link:hover{background:#c5303c}" +
      "@media(max-width:640px){#pc-fbt-section .pc-fbt-grid{grid-template-columns:repeat(2,1fr);gap:10px}#pc-fbt-section .pc-fbt-title{font-size:17px}}";

    var style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
  }

  function buildCard(item) {
    var card = document.createElement("div");
    card.className = "pc-fbt-card";

    var badgeClass = "pc-fbt-badge";
    if (item.pairingType === "accessory") badgeClass += " pc-fbt-badge--accessory";
    if (item.pairingType === "frequently_bought") badgeClass += " pc-fbt-badge--frequently_bought";

    var imgHtml = item.image
      ? '<img class="pc-fbt-card-img" src="' + item.image + '" alt="' + escapeHtml(item.name) + '" loading="lazy">'
      : '<div class="pc-fbt-card-img-placeholder">No Image</div>';

    var priceHtml = formatPrice(item.salePrice || item.price);
    if (item.salePrice && item.price && item.salePrice < item.price) {
      priceHtml =
        formatPrice(item.salePrice) +
        '<span class="pc-fbt-original">' + formatPrice(item.price) + "</span>";
    }

    var linkHtml = item.url
      ? '<a class="pc-fbt-card-link" href="' + escapeHtml(item.url) + '">View Product</a>'
      : "";

    card.innerHTML =
      imgHtml +
      '<div class="pc-fbt-card-body">' +
        '<span class="' + badgeClass + '">' + (TYPE_LABELS[item.pairingType] || item.pairingType.replace(/_/g, " ")) + "</span>" +
        '<div class="pc-fbt-card-name">' + escapeHtml(item.name) + "</div>" +
        '<div class="pc-fbt-card-sku">SKU: ' + escapeHtml(item.sku) + "</div>" +
        '<div class="pc-fbt-card-price">' + priceHtml + "</div>" +
        linkHtml +
      "</div>";

    return card;
  }

  function escapeHtml(str) {
    if (!str) return "";
    var div = document.createElement("div");
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  function render(pairings) {
    if (!pairings || pairings.length === 0) return;

    var section = document.createElement("div");
    section.id = "pc-fbt-section";

    var titleIcon =
      '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#e63946" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>' +
      "</svg>";

    var hasFBT = pairings.some(function (p) { return p.pairingType === "frequently_bought"; });
    var title = hasFBT ? "Frequently Bought Together" : "Goes Great With This Product";

    section.innerHTML =
      '<div class="pc-fbt-title">' + titleIcon + title + "</div>" +
      '<div class="pc-fbt-grid"></div>';

    var grid = section.querySelector(".pc-fbt-grid");
    for (var i = 0; i < pairings.length; i++) {
      grid.appendChild(buildCard(pairings[i]));
    }

    var target =
      document.querySelector(".productView-description") ||
      document.querySelector("[data-product-description]") ||
      document.querySelector(".productView-details") ||
      document.querySelector("form[data-cart-item-add]") ||
      document.querySelector(".productView");

    if (target) {
      target.parentNode.insertBefore(section, target.nextSibling);
    } else {
      var mainContent =
        document.querySelector("main") ||
        document.querySelector("#main-content") ||
        document.querySelector(".body");
      if (mainContent) {
        mainContent.appendChild(section);
      }
    }
  }

  function init() {
    if (!isProductPage()) return;

    var sku = getProductSku();
    if (!sku) return;

    injectStyles();

    var xhr = new XMLHttpRequest();
    xhr.open("GET", PC_FBT_URL + "/api/pairings?sku=" + encodeURIComponent(sku));
    xhr.onload = function () {
      if (xhr.status === 200) {
        try {
          var data = JSON.parse(xhr.responseText);
          if (data.pairings && data.pairings.length > 0) {
            render(data.pairings);
          }
        } catch (e) {
          console.error("[PC FBT] Parse error:", e);
        }
      }
    };
    xhr.onerror = function () {
      console.error("[PC FBT] Network error fetching pairings");
    };
    xhr.send();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
