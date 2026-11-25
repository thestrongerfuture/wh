const GITHUB_OWNER = "thestrongerfuture";
const GITHUB_REPO = "wh";
const GITHUB_BRANCH = "main";

export async function onRequestPost({ request, env }) {
  try {
    const providedPassword = request.headers.get("X-Admin-Password") || "";
    let validAdmin = false;

    if (env?.DB && providedPassword) {
      const adminRow = await env.DB
        .prepare("SELECT value FROM settings WHERE key = ?")
        .bind("admin_password")
        .first();
      if (adminRow && adminRow.value === providedPassword) {
        validAdmin = true;
      }
    }

    if (!validAdmin && env?.ADMIN_PASSWORD && providedPassword === env.ADMIN_PASSWORD) {
      validAdmin = true;
    }

    if (!validAdmin) {
      return jsonResponse({ ok: false, error: "غير مصرح بالوصول" }, 401);
    }

    const githubToken = env?.GITHUB_ASSETS_TOKEN || env?.GITHUB_TOKEN;
    if (!githubToken) {
      return jsonResponse(
        { ok: false, error: "إعداد الاتصال بمستودع الصور غير مكتمل" },
        503
      );
    }

    const body = await request.json().catch(() => null);
    const offerId = String(body?.offer_id || "").trim();
    const rawBase64 = String(body?.image_base64 || "").trim();
    const imageBase64 = rawBase64.includes(",") ? rawBase64.split(",").pop().trim() : rawBase64;

    if (!offerId || !/^[a-zA-Z0-9_-]+$/.test(offerId)) {
      return jsonResponse({ ok: false, error: "معرّف العرض غير صالح" }, 400);
    }

    if (!imageBase64) {
      return jsonResponse({ ok: false, error: "بيانات الصورة غير موجودة" }, 400);
    }

    const filePath = `offers/${offerId}.png`;
    const encodedPath = filePath
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");

    const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodedPath}`;

    const githubHeaders = {
      Authorization: `Bearer ${githubToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Elsaadany-Store"
    };

    let existingSha = null;
    const checkRes = await fetch(`${apiUrl}?ref=${encodeURIComponent(GITHUB_BRANCH)}`, {
      method: "GET",
      headers: githubHeaders
    });

    if (checkRes.ok) {
      const checkData = await checkRes.json().catch(() => null);
      existingSha = checkData?.sha || null;
    } else if (checkRes.status !== 404) {
      return jsonResponse(
        {
          ok: false,
          error: "تعذر التحقق من الملف الموجود في مستودع الصور",
          github_status: checkRes.status
        },
        502
      );
    }

    const payload = {
      message: `Upload or update offer grid image offers/${offerId}.png`,
      content: imageBase64,
      branch: GITHUB_BRANCH
    };

    if (existingSha) {
      payload.sha = existingSha;
    }

    const uploadRes = await fetch(apiUrl, {
      method: "PUT",
      headers: {
        ...githubHeaders,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!uploadRes.ok) {
      return jsonResponse(
        {
          ok: false,
          error: "فشل رفع صورة العرض إلى مستودع GitHub",
          github_status: uploadRes.status
        },
        502
      );
    }

    const uploadData = await uploadRes.json().catch(() => ({}));
    const commitSha = uploadData?.commit?.sha || null;

    return jsonResponse({
      ok: true,
      success: true,
      path: filePath,
      version: commitSha
    });
  } catch (err) {
    return jsonResponse(
      { ok: false, error: "حدث خطأ أثناء رفع صورة العرض: " + (err?.message || "") },
      500
    );
  }
}

export async function onRequestDelete({ request, env }) {
  try {
    const providedPassword = request.headers.get("X-Admin-Password") || "";
    let validAdmin = false;

    if (env?.DB && providedPassword) {
      const adminRow = await env.DB
        .prepare("SELECT value FROM settings WHERE key = ?")
        .bind("admin_password")
        .first();
      if (adminRow && adminRow.value === providedPassword) {
        validAdmin = true;
      }
    }

    if (!validAdmin && env?.ADMIN_PASSWORD && providedPassword === env.ADMIN_PASSWORD) {
      validAdmin = true;
    }

    if (!validAdmin) {
      return jsonResponse({ ok: false, error: "غير مصرح لك بالوصول" }, 401);
    }

    const githubToken = env?.GITHUB_ASSETS_TOKEN || env?.GITHUB_TOKEN;
    if (!githubToken) {
      return jsonResponse(
        { ok: false, error: "إعداد الاتصال بمستودع الصور غير مكتمل" },
        503
      );
    }

    const body = await request.json().catch(() => null);
    const offerId = String(body?.offer_id || "").trim();

    if (!offerId || !/^[a-zA-Z0-9_-]+$/.test(offerId)) {
      return jsonResponse({ ok: false, error: "معرّف العرض غير صالح" }, 400);
    }

    const filePath = `offers/${offerId}.png`;
    const encodedPath = filePath
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");

    const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodedPath}`;

    const githubHeaders = {
      Authorization: `Bearer ${githubToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Elsaadany-Store"
    };

    const checkRes = await fetch(`${apiUrl}?ref=${encodeURIComponent(GITHUB_BRANCH)}`, {
      method: "GET",
      headers: githubHeaders
    });

    if (checkRes.status === 404) {
      return jsonResponse({ ok: true, deleted: false, message: "الصورة غير موجودة مسبقاً" });
    }

    if (!checkRes.ok) {
      return jsonResponse(
        {
          ok: false,
          error: "تعذر التحقق من صورة العرض في المستودع",
          github_status: checkRes.status
        },
        502
      );
    }

    const fileData = await checkRes.json().catch(() => null);
    const sha = fileData?.sha;

    if (!sha) {
      return jsonResponse({ ok: false, error: "تعذر الحصول على بصمة ملف الصورة" }, 502);
    }

    const deleteRes = await fetch(apiUrl, {
      method: "DELETE",
      headers: {
        ...githubHeaders,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: `Delete offer grid image offers/${offerId}.png`,
        sha,
        branch: GITHUB_BRANCH
      })
    });

    if (!deleteRes.ok) {
      return jsonResponse(
        {
          ok: false,
          error: "فشل حذف صورة العرض من مستودع GitHub",
          github_status: deleteRes.status
        },
        502
      );
    }

    return jsonResponse({ ok: true, deleted: true, path: filePath });
  } catch (err) {
    return jsonResponse(
      { ok: false, error: "حدث خطأ أثناء حذف صورة العرض: " + (err?.message || "") },
      500
    );
  }
}

export async function onRequest() {
  return jsonResponse({ ok: false, error: "طريقة الطلب غير مسموحة" }, 405);
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}