(function () {
  const ALLOWED_SLUGS = [
    "",
    "index",
    "index.html",
    "new",
    "new.html",
    "offers",
    "offers.html"
  ];

  function isAllowedPage() {
    const rawPath = (window.location.pathname || "/").toLowerCase();
    const cleanPath = rawPath.length > 1 && rawPath.endsWith("/")
      ? rawPath.slice(0, -1)
      : rawPath;

    if (cleanPath === "" || cleanPath === "/") {
      return true;
    }

    const segments = cleanPath.split("/").filter(Boolean);
    const lastSegment = segments[segments.length - 1] || "";

    return ALLOWED_SLUGS.includes(lastSegment);
  }

  function removeWatermark() {
    const existing = document.getElementById("storeWatermarkLayer");
    if (existing) existing.remove();
  }

  function escapeXml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function renderTextWatermark(text, opacity) {
    removeWatermark();

    const safeText = escapeXml(text);
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="340" height="220" viewBox="0 0 340 220">
        <text x="170" y="115"
              fill="#000000"
              font-size="24"
              font-weight="700"
              font-family="system-ui, -apple-system, sans-serif"
              text-anchor="middle"
              dominant-baseline="middle"
              transform="rotate(-24 170 115)">${safeText}</text>
      </svg>
    `.trim();

    const encodedSvg = encodeURIComponent(svg);
    const layer = document.createElement("div");
    layer.id = "storeWatermarkLayer";
    layer.style.cssText = [
      "position: fixed",
      "inset: 0",
      "pointer-events: none",
      "z-index: 900",
      `opacity: ${opacity}`,
      `background-image: url("data:image/svg+xml,${encodedSvg}")`,
      "background-repeat: repeat",
      "background-position: center"
    ].join(";");

    document.body.appendChild(layer);
  }

  function renderImageWatermark(imageUrl, opacity) {
    removeWatermark();

    const layer = document.createElement("div");
    layer.id = "storeWatermarkLayer";
    layer.style.cssText = [
      "position: fixed",
      "inset: 0",
      "pointer-events: none",
      "z-index: 900",
      `opacity: ${opacity}`,
      "display: grid",
      "grid-template-columns: repeat(auto-fill, minmax(220px, 1fr))",
      "gap: 48px",
      "padding: 36px",
      "align-items: center",
      "justify-items: center",
      "overflow: hidden"
    ].join(";");

    const count = 18;
    for (let i = 0; i < count; i++) {
      const img = document.createElement("img");
      img.src = imageUrl;
      img.alt = "";
      img.setAttribute("aria-hidden", "true");
      img.style.cssText = [
        "max-width: 140px",
        "max-height: 90px",
        "width: auto",
        "height: auto",
        "object-fit: contain",
        "transform: rotate(-20deg)",
        "user-select: none"
      ].join(";");
      layer.appendChild(img);
    }

    document.body.appendChild(layer);
  }

  async function initWatermark() {
    if (!isAllowedPage()) {
      removeWatermark();
      return;
    }

    try {
      const res = await fetch("/api/settings");
      if (!res.ok) return;
      const data = await res.json();
      const settings = data.settings || {};

      if (String(settings.watermark_enabled || "0") !== "1") {
        removeWatermark();
        return;
      }

      const type = String(settings.watermark_type || "text");
      let opacity = parseFloat(settings.watermark_opacity);
      if (Number.isNaN(opacity)) opacity = 0.10;
      opacity = Math.min(0.40, Math.max(0.05, opacity));

      if (type === "text") {
        const text = String(settings.watermark_text || "").trim();
        if (!text) return removeWatermark();
        renderTextWatermark(text, opacity);
      } else if (type === "logo") {
        const logoUrl = String(settings.store_logo_url || "").trim();
        if (!logoUrl) return removeWatermark();
        renderImageWatermark(logoUrl, opacity);
      } else if (type === "image") {
        const imgUrl = String(settings.watermark_image_url || "").trim();
        if (!imgUrl) return removeWatermark();
        renderImageWatermark(imgUrl, opacity);
      }
    } catch (err) {
      console.warn("تعذر تحميل إعدادات العلامة المائية:", err);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initWatermark);
  } else {
    initWatermark();
  }
})();
