import { Route } from '#lib/route.ts';
import { expect, test } from '#test/medium/fixtures.ts';

test.describe('system settings', () => {
  for (const viewport of [
    { width: 1440, height: 1100 },
    { width: 390, height: 844 },
  ]) {
    test(`API file management settings remain usable at ${viewport.width}px`, async ({ page, api }, testInfo) => {
      await page.setViewportSize(viewport);
      await page.goto(Route.systemSettings());
      await page.getByRole('button', { name: 'admin.library_settings', exact: false }).click();
      await page.getByRole('button', { name: 'admin.library_file_management', exact: false }).click();
      await page.getByRole('switch', { name: 'admin.library_file_management_enable', exact: true }).click();
      const ownership = page.getByRole('switch', { name: 'admin.library_move_ownership', exact: true });
      await expect(ownership).toBeVisible();
      await ownership.click();
      await page
        .getByRole('combobox', { name: 'admin.library_move_shared_links', exact: true })
        .selectOption('transfer');
      const faces = page.getByRole('switch', { name: 'admin.library_move_faces', exact: true });
      await faces.click();
      await expect(faces).toBeChecked();
      await page.evaluate(async () => {
        await Promise.all(document.getAnimations().map((animation) => animation.finished));
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath('api-file-management-settings.png'), fullPage: true });
      await page.getByRole('button', { name: 'save', exact: true }).click();
      await expect.poll(() => api.updateAdminConfig.calls.length).toBe(1);
      expect(api.updateAdminConfig).toHaveBeenCalledWith({
        body: expect.objectContaining({
          library: expect.objectContaining({
            fileManagement: {
              enabled: true,
              allowOwnershipTransfer: true,
              addAlbumEditor: false,
              sharedLinkPolicy: 'transfer',
              transferFaces: true,
            },
          }),
        }),
      });
    });
  }

  test('previews an email template', async ({ page, api }) => {
    api.on({
      previewNotificationTemplateAdmin: () => ({
        body: '<style>p { color: rgb(255, 0, 0); }</style><p>Welcome preview</p>',
        contentType: 'text/html',
        headers: { 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" },
      }),
    });
    await page.goto(Route.systemSettings());

    await page.getByRole('button', { name: 'admin.notification_settings' }).click();
    await page.getByRole('button', { name: 'admin.template_email_settings' }).click();
    await page.getByRole('button', { name: 'admin.template_email_preview' }).first().click();

    const preview = page.frameLocator('iframe').getByText('Welcome preview');
    await expect(preview).toBeVisible();
    await expect(preview).toHaveCSS('color', 'rgb(255, 0, 0)');
    expect(api.previewNotificationTemplateAdmin).toHaveBeenCalledWith({
      params: { name: 'welcome' },
      body: 'template=',
    });
  });

  test('previews the storage template', async ({ page, data, api }) => {
    data.adminConfig.storageTemplate.enabled = true;
    data.adminConfig.storageTemplate.template = '{{y}}/{{filename}}';
    api.on({
      getAdminStorageTemplateOptions: () => ({
        json: {
          yearOptions: ['y'],
          monthOptions: ['MM'],
          weekOptions: ['W'],
          dayOptions: ['dd'],
          hourOptions: ['HH'],
          minuteOptions: ['mm'],
          secondOptions: ['ss'],
          presets: [{ template: '{{y}}/{{filename}}', preview: '2022/IMAGE_56437' }],
        },
      }),
      previewStorageTemplate: ({ body }) => ({ json: { preview: `preview of ${body.template}` } }),
    });
    await page.goto(Route.systemSettings());

    await page.getByRole('button', { name: 'admin.storage_template_settings' }).click();

    await expect(page.getByRole('option', { name: '2022/IMAGE_56437' })).toBeAttached();
    await expect(page.getByText('preview of {{y}}/{{filename}}.jpg')).toBeVisible();

    await page.getByRole('textbox', { name: 'template' }).fill('{{y}}/{{MM}}');

    await expect(page.getByText('preview of {{y}}/{{MM}}.jpg')).toBeVisible();
    expect(api.previewStorageTemplate).toHaveBeenCalledWith({ body: { template: '{{y}}/{{MM}}' } });
  });
});
