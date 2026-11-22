const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  }
});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({
        ok: true,
        service: "storyforge-worker",
        databaseBindingPresent: Boolean(env.DB),
        authentication: "not-configured",
        applicationApi: "disabled-until-authentication-is-implemented"
      });
    }

    // Fail closed: no project or account data API is exposed before
    // GitHub OAuth, verified sessions, CSRF protection, and ownership
    // checks are implemented and tested.
    if (url.pathname.startsWith("/api/")) {
      return json({
        error: "API_NOT_READY",
        message: "ระบบบัญชีและการจัดเก็บข้อมูลบนเซิร์ฟเวอร์ยังอยู่ระหว่างพัฒนา"
      }, 503);
    }

    if (!env.ASSETS) {
      return new Response("Static asset binding is not configured.", { status: 503 });
    }

    return env.ASSETS.fetch(request);
  }
};
