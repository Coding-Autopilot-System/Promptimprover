import { test, expect } from '@playwright/test';

test.describe('Intelligence Hub Dashboard UI', () => {
  test.beforeEach(async ({ page }) => {
    // Fail the test if there are any uncaught Javascript errors on the page
    page.on('pageerror', err => {
      throw new Error(`Uncaught page error: ${err.message}`);
    });
    
    // Fail the test if there are any console.error logs
    page.on('console', msg => {
      if (msg.type() === 'error') {
        throw new Error(`Console error: ${msg.text()}`);
      }
    });
    
    await page.goto('http://localhost:3999');
  });

  test('should load the dashboard and display the sidebar and projects', async ({ page }) => {
    // Check page title
    await expect(page).toHaveTitle(/PromptImprover/);

    // Sidebar should be visible
    const sidebar = page.locator('.sidebar');
    await expect(sidebar).toBeVisible();

    // Verify main navigation items
    await expect(page.locator('.nav-item', { hasText: 'GLOBAL STREAM' })).toBeVisible();
    await expect(page.locator('.nav-item', { hasText: 'COMMIT INTELLIGENCE' })).toBeVisible();

    // Verify project list is populated (at least the ROOT project)
    const projectList = page.locator('#project-list');
    await expect(projectList).toBeVisible();
    
    // Wait for the first project item to appear
    const projectItem = projectList.locator('.nav-item').first();
    await expect(projectItem).toBeVisible({ timeout: 5000 });
  });

  test('should display the floating pulse bar with elements', async ({ page }) => {
    const pulseBar = page.locator('.pulse-bar');
    await expect(pulseBar).toBeVisible();

    // Pulse bar items
    await expect(page.locator('#pb-connected')).toBeVisible();
    await expect(page.locator('#pb-autopilot')).toBeVisible();
    await expect(page.locator('#pb-sync-label')).toBeVisible();
  });

  test('should switch views when navigation items are clicked', async ({ page }) => {
    // Initial view should be Global Stream
    await expect(page.locator('#view-stream')).not.toHaveClass(/hidden/);
    
    // Click 'COMMIT INTELLIGENCE'
    const navItem = page.locator('.nav-item', { hasText: 'COMMIT INTELLIGENCE' });
    await navItem.waitFor({ state: 'visible' });
    await navItem.click({ force: true });
    
    // View should switch
    await expect(page.locator('#view-intelligence')).not.toHaveClass(/hidden/);
    await expect(page.locator('#view-stream')).toHaveClass(/hidden/);
    
    await page.locator('.nav-item', { hasText: 'Provider Health' }).click();
    await expect(page.locator('#view-health')).not.toHaveClass(/hidden/);
  });

  test('should render newly ingested proxy prompts in the global stream', async ({ page, request }) => {
    // 1. Programmatically send a prompt via the proxy endpoint
    const uniquePrompt = `Automated Proxy Stream Test - ${Date.now()}`;
    const proxyResponse = await request.post('http://localhost:3999/proxy/v1/chat/completions', {
      data: {
        messages: [{ role: 'user', content: uniquePrompt }]
      }
    });
    
    // The upstream might fail because we haven't configured a real API key, but the proxy 
    // will still record the prompt before calling upstream. We don't care about upstream status here.
    
    // 2. Go to the Global Stream view (which is default, but let's be explicit)
    await page.locator('.nav-item', { hasText: 'GLOBAL STREAM' }).click();
    await expect(page.locator('#view-stream')).not.toHaveClass(/hidden/);

    // Wait for the timeline terminal to populate the prompt
    const timelineTerminal = page.locator('#timeline-terminal');
    
    // 3. Assert the unique prompt is rendered with the PRM tag
    const logLine = timelineTerminal.locator('.log-line', { hasText: uniquePrompt });
    await expect(logLine).toBeVisible({ timeout: 10000 });
    
    // Check that it's categorized as a prompt
    await expect(logLine.locator('.log-icon')).toContainText('PRM');
  });

  test('should render main grids and cards', async ({ page }) => {
    // Global Stream view cards
    await expect(page.locator('#view-stream .card')).toBeVisible();
    await expect(page.locator('#timeline-terminal')).toBeVisible();
  });
});
