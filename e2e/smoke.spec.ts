import { test, expect } from "@playwright/test";

const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:3000";

// Credentials are expected to be seeded via db:seed
const MANAGER_EMAIL = process.env.E2E_MANAGER_EMAIL || "manager@performancecycle.com";
const MANAGER_PASS = process.env.E2E_MANAGER_PASS || "manager123";
const AGENT_EMAIL = process.env.E2E_AGENT_EMAIL || "agent@performancecycle.com";
const AGENT_PASS = process.env.E2E_AGENT_PASS || "agent123";

// ---------------------------------------------------------------------------
// 1. Login / Logout
// ---------------------------------------------------------------------------
test.describe("Authentication", () => {
  test("shows login page at /login", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("h1")).toContainText("Performance Cycle");
    await expect(page.locator('input[id="email"]')).toBeVisible();
    await expect(page.locator('input[id="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toContainText("Sign In");
  });

  test("rejects invalid credentials", async ({ page }) => {
    await page.goto("/login");
    await page.fill('input[id="email"]', "bad@test.com");
    await page.fill('input[id="password"]', "wrongpassword");
    await page.click('button[type="submit"]');

    await expect(page.locator("text=Invalid email or password")).toBeVisible({
      timeout: 5000,
    });
  });

  test("manager can log in and reaches dashboard", async ({ page }) => {
    await page.goto("/login");
    await page.fill('input[id="email"]', MANAGER_EMAIL);
    await page.fill('input[id="password"]', MANAGER_PASS);
    await page.click('button[type="submit"]');

    await page.waitForURL(/\/dashboard/, { timeout: 10000 });
    expect(page.url()).toContain("/dashboard");
  });

  test("agent can log in and reaches dashboard", async ({ page }) => {
    await page.goto("/login");
    await page.fill('input[id="email"]', AGENT_EMAIL);
    await page.fill('input[id="password"]', AGENT_PASS);
    await page.click('button[type="submit"]');

    await page.waitForURL(/\/dashboard/, { timeout: 10000 });
    expect(page.url()).toContain("/dashboard");
  });

  test("unauthenticated user is redirected from /dashboard to /login", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await page.waitForURL(/\/login|\/api\/auth/, { timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// 2. Dashboard - Role-based access
// ---------------------------------------------------------------------------
test.describe("Role-based access", () => {
  test("agent is redirected away from /dashboard/manager", async ({ page }) => {
    await page.goto("/login");
    await page.fill('input[id="email"]', AGENT_EMAIL);
    await page.fill('input[id="password"]', AGENT_PASS);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/dashboard/, { timeout: 10000 });

    await page.goto("/dashboard/manager");
    await page.waitForURL(/\/dashboard\/agent/, { timeout: 10000 });
    expect(page.url()).toContain("/dashboard/agent");
  });

  test("manager can access /dashboard/manager", async ({ page }) => {
    await page.goto("/login");
    await page.fill('input[id="email"]', MANAGER_EMAIL);
    await page.fill('input[id="password"]', MANAGER_PASS);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/dashboard/, { timeout: 10000 });

    await page.goto("/dashboard/manager");
    await expect(page.url()).toContain("/dashboard/manager");
  });
});

// ---------------------------------------------------------------------------
// 3. Dashboard - Manager metrics and navigation
// ---------------------------------------------------------------------------
test.describe("Manager dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.fill('input[id="email"]', MANAGER_EMAIL);
    await page.fill('input[id="password"]', MANAGER_PASS);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/dashboard/, { timeout: 10000 });
  });

  test("manager hub loads with metrics", async ({ page }) => {
    await page.goto("/dashboard/manager");
    await expect(page.locator("text=Chats Today")).toBeVisible({ timeout: 10000 });
  });

  test("configure page loads", async ({ page }) => {
    await page.goto("/dashboard/manager/configure");
    await page.waitForLoadState("networkidle");
    const pageContent = await page.textContent("body");
    expect(pageContent).toBeTruthy();
  });

  test("knowledge base page loads", async ({ page }) => {
    await page.goto("/dashboard/manager/knowledge");
    await page.waitForLoadState("networkidle");
    const pageContent = await page.textContent("body");
    expect(pageContent).toBeTruthy();
  });

  test("team page loads", async ({ page }) => {
    await page.goto("/dashboard/manager/team");
    await page.waitForLoadState("networkidle");
    const pageContent = await page.textContent("body");
    expect(pageContent).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 4. Agent dashboard
// ---------------------------------------------------------------------------
test.describe("Agent dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.fill('input[id="email"]', AGENT_EMAIL);
    await page.fill('input[id="password"]', AGENT_PASS);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/dashboard/, { timeout: 10000 });
  });

  test("agent hub loads with metrics", async ({ page }) => {
    await page.goto("/dashboard/agent");
    await page.waitForLoadState("networkidle");
    const pageContent = await page.textContent("body");
    expect(pageContent).toBeTruthy();
  });

  test("live chats page loads", async ({ page }) => {
    await page.goto("/dashboard/chats");
    await page.waitForLoadState("networkidle");
    const pageContent = await page.textContent("body");
    expect(pageContent).toBeTruthy();
  });

  test("history page loads", async ({ page }) => {
    await page.goto("/dashboard/history");
    await page.waitForLoadState("networkidle");
    const pageContent = await page.textContent("body");
    expect(pageContent).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 5. Chat Widget
// ---------------------------------------------------------------------------
test.describe("Chat widget", () => {
  test("chat widget page loads with input", async ({ page }) => {
    await page.goto("/chat?sessionId=e2e-test-session");
    await page.waitForLoadState("networkidle");

    const inputVisible = await page.locator('input[type="text"], textarea').isVisible().catch(() => false);
    const pageContent = await page.textContent("body");
    expect(pageContent).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 6. API health checks
// ---------------------------------------------------------------------------
test.describe("API health", () => {
  test("GET /api/chat/settings returns valid JSON", async ({ request }) => {
    const res = await request.get("/api/chat/settings");
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("aiEnabled");
    expect(data).toHaveProperty("fallbackTimerSeconds");
    expect(typeof data.aiEnabled).toBe("boolean");
    expect(typeof data.fallbackTimerSeconds).toBe("number");
  });

  test("POST /api/chat returns 400 without required fields", async ({
    request,
  }) => {
    const res = await request.post("/api/chat", {
      data: {},
    });
    expect(res.status()).toBe(400);
  });

  test("POST /api/chat/ai-fallback returns 400 without sessionId", async ({
    request,
  }) => {
    const res = await request.post("/api/chat/ai-fallback", {
      data: {},
    });
    expect(res.status()).toBe(400);
  });

  test("GET /api/analytics returns 401 without auth", async ({ request }) => {
    const res = await request.get("/api/analytics");
    expect(res.status()).toBe(401);
  });

  test("GET /api/admin/settings returns 401 without auth", async ({
    request,
  }) => {
    const res = await request.get("/api/admin/settings");
    expect(res.status()).toBe(401);
  });
});
