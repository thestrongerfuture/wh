
export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  // إذا لم يوجد معرّف المنتج، نعيد التوجيه للرئيسية
  if (!id || !id.trim()) {
    return Response.redirect(url.origin, 302);
  }

  try {
    // 1. جلب بيانات المنتج
    const product = await env.DB.prepare(`
      SELECT id, name, description, price, image_url
      FROM products
      WHERE id = ?
    `).bind(id).first();

    if (!product) {
      return Response.redirect(url.origin, 302);
    }

    // 2. جلب اسم المتجر من الإعدادات
    const settingsResult = await env.DB.prepare(`
      SELECT key, value
      FROM settings
      WHERE key IN ('store_name_ar', 'store_name_en')
    `).all();

    const settings = {};

    for (const item of settingsResult.results || []) {
      settings[item.key] = item.value || "";
    }

    const storeName =
      settings.store_name_ar ||
      settings.store_name_en ||
      "";

    // 3. تجهيز عنوان المشاركة
    const productName = String(product.name || "");
    const title = storeName
      ? `${productName} | ${storeName}`
      : productName;

    // 4. تجهيز وصف المشاركة من بيانات المنتج
    const productDescription = String(
      product.description || ""
    ).trim();

    const priceText = product.price !== null &&
      product.price !== undefined
        ? `السعر: $${product.price}`
        : "";

    const descriptionParts = [
      productDescription,
      priceText,
      storeName
    ].filter(Boolean);

    const description = descriptionParts.join(" | ") ||
      productName;

    // 5. تجهيز رابط فتح المنتج داخل المتجر
    const redirect = new URL("/", url.origin);
    redirect.searchParams.set("id", String(product.id));

    const redirectUrl = redirect.href;

    // 6. تجهيز صورة المشاركة مع بدائل تلقائية في حال كان image_url فارغاً
    const isValidHttpUrl = (candidate) => {
      try {
        const parsed = new URL(candidate, url.origin);
        if (parsed.protocol === "https:" || parsed.protocol === "http:") {
          return parsed.href;
        }
      } catch {
        return "";
      }
      return "";
    };

    const imageExistsAtUrl = async (candidateUrl) => {
      try {
        const headRes = await fetch(candidateUrl, { method: "HEAD" });
        if (headRes.ok) {
          const contentType = headRes.headers.get("content-type") || "";
          return !contentType || contentType.startsWith("image/");
        }
      } catch {
        // نجرّب GET كخيار احتياطي إذا السيرفر لا يدعم HEAD
      }

      try {
        const getRes = await fetch(candidateUrl, { method: "GET" });
        if (getRes.ok) {
          const contentType = getRes.headers.get("content-type") || "";
          return !contentType || contentType.startsWith("image/");
        }
      } catch {
        return false;
      }

      return false;
    };

    let imageUrl = "";
    const directDbImage =
      typeof product.image_url === "string" ? product.image_url.trim() : "";

    if (directDbImage) {
      imageUrl = isValidHttpUrl(directDbImage);
    }

    if (!imageUrl) {
      const safeId = encodeURIComponent(String(product.id || "").trim());
      const fallbackCandidates = safeId
        ? [
            `/api/image/products/${safeId}.webp`,
            `/api/image/products/${safeId}.jpg`,
            `/api/image/products/${safeId}.jpeg`,
            `/api/image/products/${safeId}.png`,
            `/images/products/${safeId}.webp`,
            `/images/products/${safeId}.jpg`,
            `/images/products/${safeId}.png`
          ]
        : [];

      for (const relPath of fallbackCandidates) {
        const fullCandidateUrl = isValidHttpUrl(relPath);
        if (fullCandidateUrl && (await imageExistsAtUrl(fullCandidateUrl))) {
          imageUrl = fullCandidateUrl;
          break;
        }
      }
    }

    if (!imageUrl) {
      const storeLogoResult = await env.DB.prepare(`
        SELECT value
        FROM settings
        WHERE key = 'store_logo_url'
        LIMIT 1
      `).first();

      const rawStoreLogo = String(storeLogoResult?.value || "").trim();
      imageUrl = isValidHttpUrl(rawStoreLogo) || isValidHttpUrl("/images/logo.png");
    }

    // 7. تأمين النصوص قبل إدراجها في HTML
    const escapeHtml = (value) => {
      return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    };

    const safeTitle = escapeHtml(title);
    const safeDescription = escapeHtml(description);
    const safeRedirectUrl = escapeHtml(redirectUrl);
    const safeImageUrl = escapeHtml(imageUrl);

    // 8. إنشاء وسوم المشاركة
    const imageMetaTags = imageUrl
      ? `
  <meta property="og:image" content="${safeImageUrl}">
  <meta name="twitter:image" content="${safeImageUrl}">
`
      : "";

    const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">

  <title>${safeTitle}</title>

  <meta name="description" content="${safeDescription}">

  <!-- Open Graph -->
  <meta property="og:title" content="${safeTitle}">
  <meta property="og:description" content="${safeDescription}">
  <meta property="og:url" content="${safeRedirectUrl}">
  <meta property="og:type" content="product">
  ${imageMetaTags}

  <!-- Twitter -->
  <meta name="twitter:card" content="${imageUrl ? "summary_large_image" : "summary"}">
  <meta name="twitter:title" content="${safeTitle}">
  <meta name="twitter:description" content="${safeDescription}">

  <!-- تحويل الزائر إلى المتجر -->
  <meta http-equiv="refresh" content="0;url=${safeRedirectUrl}">

  <script>
    window.location.replace(${JSON.stringify(redirectUrl)
      .replace(/</g, "\\u003c")
      .replace(/>/g, "\\u003e")
      .replace(/&/g, "\\u0026")});
  </script>
</head>
<body>
  <p>
    جاري تحويلك إلى صفحة المنتج...
    <a href="${safeRedirectUrl}">اضغط هنا</a>
  </p>
</body>
</html>`;

    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache"
      }
    });

  } catch (error) {
    return Response.redirect(url.origin, 302);
  }
}
