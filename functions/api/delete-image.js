const GITHUB_OWNER = "thestrongerfuture";
const GITHUB_REPO = "wh";
const GITHUB_BRANCH = "main";const STORE_LOGO_KEY = "Logo.png";
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

    // 3. التحقق من وجود GitHub Token
    const githubToken = env.GITHUB_ASSETS_TOKEN;

    if (!githubToken) {
      return jsonResponse({
        ok: false,
        success: false,
        error: "إعداد الاتصال بمستودع الصور غير مكتمل"
      }, 503);
    }

    // 4. قراءة البيانات
    const body = await request.json();
    const type = body.type;

    let key;
    let productId = null;

    if (type === "logo") {
      key = STORE_LOGO_KEY;

    } else if (type === "watermark") {
      key = WATERMARK_IMAGE_KEY;

    } else if (type === "product") {
      productId = String(
        body.id || body.productId || ""
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

      // التحقق من وجود المنتج وصورته
      const product = await env.DB.prepare(
        "SELECT id, image_url FROM products WHERE id = ?"
      ).bind(productId).first();

      if (!product) {
        return jsonResponse({
          ok: false,
          success: false,
          error: "المنتج غير موجود"
        }, 404);
      }

      if (!product.image_url) {
        return jsonResponse({
          ok: false,
          success: false,
          error: "هذا المنتج لا يحتوي على صورة مسجلة"
        }, 404);
      }

      // التأكد من أن رابط الصورة تابع لمسار المنتج الصحيح
      const expectedPath =
        `/api/image/products/${encodeURIComponent(productId)}.webp`;

      let imageUrl;

      try {
        imageUrl = new URL(product.image_url, request.url);
      } catch {
        return jsonResponse({
          ok: false,
          success: false,
          error: "رابط صورة المنتج غير صالح"
        }, 409);
      }

      if (
        imageUrl.origin !== new URL(request.url).origin ||
        imageUrl.pathname !== expectedPath
      ) {
        return jsonResponse({
          ok: false,
          success: false,
          error: "رابط صورة المنتج غير مطابق لمسار التخزين"
        }, 409);
      }

      key = `products/${encodeURIComponent(productId)}.webp`;

    } else {
      return jsonResponse({
        ok: false,
        success: false,
        error: "نوع الصورة غير معروف"
      }, 400);
    }

    // 5. تجهيز مسار الملف في GitHub
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

    // 6. الحصول على بيانات الملف و SHA
    const fileResponse = await fetch(
      `${githubUrl}?ref=${encodeURIComponent(GITHUB_BRANCH)}`,
      {
        method: "GET",
        headers: githubHeaders
      }
    );

    if (fileResponse.status === 404) {
      return jsonResponse({
        ok: false,
        success: false,
        error: "الصورة غير موجودة في مستودع GitHub"
      }, 404);
    }

    if (!fileResponse.ok) {
      return jsonResponse({
        ok: false,
        success: false,
        error: "تعذر الوصول إلى ملف الصورة في GitHub",
        github_status: fileResponse.status
      }, 502);
    }

    const fileData = await fileResponse.json();

    if (!fileData.sha) {
      return jsonResponse({
        ok: false,
        success: false,
        error: "تعذر الحصول على معرف الملف في GitHub"
      }, 502);
    }

    // 7. حذف الملف من GitHub
    const deleteMessage = type === "logo"
      ? "Delete store logo"
      : type === "watermark"
        ? "Delete watermark image"
        : "Delete product image";

    const deleteResponse = await fetch(githubUrl, {
      method: "DELETE",
      headers: {
        ...githubHeaders,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: deleteMessage,
        sha: fileData.sha,
        branch: GITHUB_BRANCH
      })
    });

    if (!deleteResponse.ok) {
      return jsonResponse({
        ok: false,
        success: false,
        error: "فشل حذف الصورة من مستودع GitHub",
        github_status: deleteResponse.status
      }, 502);
    }

    // 8. تحديث قاعدة البيانات بعد نجاح الحذف
    if (type === "logo") {
      await env.DB.batch([
        env.DB.prepare(
          "DELETE FROM settings WHERE key = ?"
        ).bind("store_logo_url"),

        env.DB.prepare(
          "DELETE FROM settings WHERE key = ?"
        ).bind("store_brand_palette")
      ]);

    } else if (type === "watermark") {
      await env.DB.prepare(
        "DELETE FROM settings WHERE key = ?"
      ).bind("watermark_image_url").run();

    } else {
      await env.DB.prepare(
        "UPDATE products SET image_url = '' WHERE id = ?"
      ).bind(productId).run();
    }

    // 9. تأكيد نجاح العملية
    return jsonResponse({
      ok: true,
      success: true,
      message: "تم حذف الصورة ومسح بياناتها بنجاح",
      key
    });

  } catch (error) {
    return jsonResponse({
      ok: false,
      success: false,
      error: "حدث خطأ أثناء حذف الصورة: " + error.message
    }, 500);
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}
