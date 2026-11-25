const GITHUB_OWNER = "thestrongerfuture";
const GITHUB_REPO = "wh";
const GITHUB_BRANCH = "main";const MAX_FILE_SIZE = 5 * 1024 * 1024;
const STORE_LOGO_KEY = "Logo.png";
const WATERMARK_IMAGE_KEY = "Watermark.png";

export async function onRequestPost({ request, env }) {
  try {
    // 1. التحقق من طريقة الطلب
    if (request.method !== "POST") {
      return jsonResponse({
        ok: false,
        success: false,
        error: "طريقة الطلب غير مسموحة"
      }, 405);
    }

    // 2. التحقق من كلمة مرور المدير
    const password = request.headers.get("X-Admin-Password") || "";

    if (!password) {
      return jsonResponse({
        ok: false,
        success: false,
        error: "غير مصرح بالوصول"
      }, 401);
    }

    const admin = await env.DB.prepare(
      "SELECT value FROM settings WHERE key = ?"
    ).bind("admin_password").first();

    if (!admin || admin.value !== password) {
      return jsonResponse({
        ok: false,
        success: false,
        error: "كلمة مرور المدير غير صحيحة"
      }, 401);
    }

    // 3. التحقق من وجود رمز الوصول إلى المستودع
    const githubToken = env.GITHUB_ASSETS_TOKEN;

    if (!githubToken) {
      return jsonResponse({
        ok: false,
        success: false,
        error: "إعداد الاتصال بمستودع الصور غير مكتمل"
      }, 503);
    }

    // 4. قراءة بيانات الصورة المرسلة
    const formData = await request.formData();

    const type = formData.get("type");
    const file = formData.get("file");

    if (!file || typeof file.arrayBuffer !== "function") {
      return jsonResponse({
        ok: false,
        success: false,
        error: "لم يتم اختيار ملف صورة صالح"
      }, 400);
    }

    // 5. التحقق من حجم الصورة
    if (file.size <= 0 || file.size > MAX_FILE_SIZE) {
      return jsonResponse({
        ok: false,
        success: false,
        error: "حجم الصورة يجب ألا يتجاوز 5 ميجابايت"
      }, 400);
    }

    // 6. تحديد مسار الحفظ والتحقق من نوع الصورة
    let key;
    let expectedMime;
    let productId = null;

    if (type === "logo") {
      key = STORE_LOGO_KEY;
      expectedMime = "image/png";

    } else if (type === "watermark") {
      key = WATERMARK_IMAGE_KEY;
      expectedMime = "image/png";

    } else if (type === "product") {
      productId = String(
        formData.get("id") ||
        formData.get("productId") ||
        ""
      ).trim();

      if (
        !productId ||
        productId.length > 100 ||
        productId === "." ||
        productId === ".." ||
        /[\/\\]/.test(productId)
      ) {
        return jsonResponse({
          ok: false,
          success: false,
          error: "معرّف المنتج غير صالح"
        }, 400);
      }

      key = `products/${encodeURIComponent(productId)}.webp`;
      expectedMime = "image/webp";

    } else {
      return jsonResponse({
        ok: false,
        success: false,
        error: "نوع الصورة غير معروف"
      }, 400);
    }

    if (file.type !== expectedMime) {
      return jsonResponse({
        ok: false,
        success: false,
        error: type === "logo"
          ? "يجب أن يكون الشعار بصيغة PNG"
          : type === "watermark"
            ? "يجب أن تكون صورة العلامة المائية بصيغة PNG"
            : "يجب أن تكون صورة المنتج بصيغة WebP"
      }, 400);
    }

    // 7. قراءة الصورة والتحقق من سلامتها
    const fileBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(fileBuffer);

    if (type === "logo" || type === "watermark") {
      const pngSignature = [
        0x89, 0x50, 0x4E, 0x47,
        0x0D, 0x0A, 0x1A, 0x0A
      ];

      const validPng = pngSignature.every(
        (byte, index) => bytes[index] === byte
      );

      if (!validPng) {
        return jsonResponse({
          ok: false,
          success: false,
          error: "محتوى الملف ليس صورة PNG صالحة"
        }, 400);
      }

    } else {
      const isRiff =
        bytes[0] === 0x52 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x46;

      const isWebp =
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50;

      if (!isRiff || !isWebp) {
        return jsonResponse({
          ok: false,
          success: false,
          error: "محتوى الملف ليس صورة WebP صالحة"
        }, 400);
      }
    }

    // 8. ترميز الصورة للإرسال إلى المستودع
    const base64Content = arrayBufferToBase64(fileBuffer);

    // 9. تجهيز مسار الملف في مستودع الصور
    const encodedPath = key
      .split("/")
      .map(segment => encodeURIComponent(segment))
      .join("/");

    const githubUrl =
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodedPath}`;

    const githubHeaders = {
      "Authorization": `Bearer ${githubToken}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Elsaadany-Store"
    };

    // 10. التحقق إذا كان الملف موجوداً مسبقاً للحصول على رقم بصمته
    const existingResponse = await fetch(
      `${githubUrl}?ref=${encodeURIComponent(GITHUB_BRANCH)}`,
      {
        method: "GET",
        headers: githubHeaders
      }
    );

    let existingSha = null;

    if (existingResponse.ok) {
      const existingFile = await existingResponse.json();
      existingSha = existingFile.sha;

    } else if (existingResponse.status !== 404) {
      return jsonResponse({
        ok: false,
        success: false,
        error: "تعذر التحقق من الملف الموجود في مستودع الصور",
        github_status: existingResponse.status
      }, 502);
    }

    // 11. حماية صور المنتجات الموجودة من الاستبدال غير المقصود
    if (type === "product" && existingSha) {
      const existingProduct = await env.DB.prepare(
        "SELECT id FROM products WHERE id = ?"
      ).bind(productId).first();

      if (!existingProduct) {
        return jsonResponse({
          ok: false,
          success: false,
          error: "توجد صورة بهذا الرمز في مستودع الصور، لكن المنتج غير موجود في قاعدة البيانات. تم منع استبدال الصورة لحمايتها."
        }, 409);
      }
    }

    // 12. رفع الصورة أو استبدالها في المستودع
    const commitMessage = type === "logo"
      ? "Update store logo in Logo.png"
      : type === "watermark"
        ? "Update watermark image in Watermark.png"
        : "Upload or update product image";

    const uploadPayload = {
      message: commitMessage,
      content: base64Content,
      branch: GITHUB_BRANCH
    };

    if (existingSha) {
      uploadPayload.sha = existingSha;
    }

    const uploadResponse = await fetch(githubUrl, {
      method: "PUT",
      headers: {
        ...githubHeaders,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(uploadPayload)
    });

    if (!uploadResponse.ok) {
      return jsonResponse({
        ok: false,
        success: false,
        error: "فشل رفع الصورة إلى مستودع GitHub",
        github_status: uploadResponse.status
      }, 502);
    }

    const uploadResult = await uploadResponse.json();
    const commitSha = uploadResult.commit?.sha;

    if (!commitSha) {
      return jsonResponse({
        ok: false,
        success: false,
        error: "تم رفع الصورة لكن تعذر الحصول على رقم إصدارها"
      }, 502);
    }

    // 13. بناء رابط عرض الصورة المباشر
    const imageUrl = (type === "logo" || type === "watermark")
      ? `/api/image/${encodedPath}`
      : `/api/image/${encodedPath}?v=${encodeURIComponent(commitSha)}`;

    // 14. حفظ الرابط في إعدادات قاعدة البيانات
    if (type === "logo") {
      await env.DB.prepare(`
        INSERT INTO settings (key, value)
        VALUES (?, ?)
        ON CONFLICT(key)
        DO UPDATE SET value = excluded.value
      `).bind("store_logo_url", imageUrl).run();

    } else if (type === "watermark") {
      await env.DB.prepare(`
        INSERT INTO settings (key, value)
        VALUES (?, ?)
        ON CONFLICT(key)
        DO UPDATE SET value = excluded.value
      `).bind("watermark_image_url", imageUrl).run();
    }

    // 15. إرجاع نتيجة العملية
    return jsonResponse({
      ok: true,
      success: true,
      message: existingSha
        ? "تم استبدال الصورة بنجاح"
        : "تم رفع الصورة بنجاح",
      key,
      image_url: imageUrl,
      version: commitSha
    });

  } catch (error) {
    return jsonResponse({
      ok: false,
      success: false,
      error: "حدث خطأ أثناء رفع الصورة: " + error.message
    }, 500);
  }
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;

  let binary = "";

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(
      i,
      Math.min(i + chunkSize, bytes.length)
    );

    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}
