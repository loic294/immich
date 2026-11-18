<script lang="ts">
  import SettingAccordion from '#lib/components/shared-components/settings/SettingAccordion.svelte';
  import SettingInputField from '#lib/components/shared-components/settings/SettingInputField.svelte';
  import SettingSwitch from '#lib/components/shared-components/settings/SettingSwitch.svelte';
  import SettingButtonsRow from '#lib/components/shared-components/settings/SystemConfigButtonRow.svelte';
  import { SettingInputFieldType } from '#lib/constants.ts';
  import FormatMessage from '#lib/elements/FormatMessage.svelte';
  import { featureFlagsManager } from '#lib/managers/feature-flags-manager.svelte.ts';
  import { createPreloadedQuery } from '#lib/queries/client.ts';
  import { getAdminConfigQuery } from '#lib/queries/config-admin.query.ts';
  import { LibrarySharedLinkPolicy } from '@immich/sdk';
  import { Link } from '@immich/ui';
  import { cloneDeep } from 'lodash-es';
  import { t } from 'svelte-i18n';
  import { fade } from 'svelte/transition';
  import SettingSelect from './SettingSelect.svelte';

  const query = createPreloadedQuery(getAdminConfigQuery);
  const config = $derived(query.data);

  const disabled = $derived(featureFlagsManager.value.configFile);
  let configToEdit = $state(cloneDeep(config));

  let cronExpressionOptions = $derived([
    { text: $t('interval.night_at_midnight'), value: '0 0 * * *' },
    { text: $t('interval.night_at_twoam'), value: '0 2 * * *' },
    { text: $t('interval.day_at_onepm'), value: '0 13 * * *' },
    { text: $t('interval.hours', { values: { hours: 6 } }), value: '0 */6 * * *' },
  ]);
  let sharedLinkPolicyOptions = $derived([
    {
      text: $t('admin.library_move_shared_links_transfer'),
      value: LibrarySharedLinkPolicy.Transfer,
    },
    {
      text: $t('admin.library_move_shared_links_delete'),
      value: LibrarySharedLinkPolicy.Delete,
    },
    {
      text: $t('admin.library_move_shared_links_detach'),
      value: LibrarySharedLinkPolicy.Detach,
    },
  ]);
</script>

<div>
  <div in:fade={{ duration: 500 }}>
    <form autocomplete="off" onsubmit={(event) => event.preventDefault()}>
      <div class="ms-4 mt-4 flex flex-col gap-4">
        <SettingAccordion
          key="library-watching"
          title={$t('admin.library_watching_settings')}
          subtitle={$t('admin.library_watching_settings_description')}
        >
          <div class="ms-4 mt-4 flex flex-col gap-4">
            <SettingSwitch
              title={$t('admin.library_watching_enable_description')}
              {disabled}
              bind:checked={configToEdit.library.watch.enabled}
            />
          </div>
        </SettingAccordion>

        <SettingAccordion
          key="library-scanning"
          title={$t('admin.library_scanning')}
          subtitle={$t('admin.library_scanning_description')}
        >
          <div class="ms-4 mt-4 flex flex-col gap-4">
            <SettingSwitch
              title={$t('admin.library_scanning_enable_description')}
              {disabled}
              bind:checked={configToEdit.library.scan.enabled}
            />

            <SettingSelect
              options={cronExpressionOptions}
              disabled={disabled || !configToEdit.library.scan.enabled}
              name="expression"
              label={$t('admin.cron_expression_presets')}
              bind:value={configToEdit.library.scan.cronExpression}
            />

            <SettingInputField
              inputType={SettingInputFieldType.TEXT}
              required={true}
              disabled={disabled || !configToEdit.library.scan.enabled}
              label={$t('admin.cron_expression')}
              bind:value={configToEdit.library.scan.cronExpression}
              isEdited={configToEdit.library.scan.cronExpression !== config.library.scan.cronExpression}
            >
              {#snippet descriptionSnippet()}
                <p class="text-sm dark:text-immich-dark-fg">
                  <FormatMessage key="admin.cron_expression_description">
                    {#snippet children({ message })}
                      <Link
                        href="https://crontab.guru/#{configToEdit.library.scan.cronExpression.replaceAll(' ', '_')}"
                      >
                        {message}
                      </Link>
                    {/snippet}
                  </FormatMessage>
                </p>
              {/snippet}
            </SettingInputField>
          </div>
        </SettingAccordion>

        {#if configToEdit.library.fileManagement}
          <SettingAccordion
            key="library-file-management"
            title={$t('admin.library_file_management')}
            subtitle={$t('admin.library_file_management_description')}
          >
            <div class="ms-4 mt-4 flex flex-col gap-4">
              <SettingSwitch
                title={$t('admin.library_file_management_enable')}
                subtitle={$t('admin.library_file_management_enable_description')}
                {disabled}
                bind:checked={configToEdit.library.fileManagement.enabled}
              />
              <SettingSwitch
                title={$t('admin.library_move_ownership')}
                subtitle={$t('admin.library_move_ownership_description')}
                disabled={disabled || !configToEdit.library.fileManagement.enabled}
                bind:checked={configToEdit.library.fileManagement.allowOwnershipTransfer}
              />
              <SettingSwitch
                title={$t('admin.library_move_album_editor')}
                subtitle={$t('admin.library_move_album_editor_description')}
                disabled={disabled ||
                  !configToEdit.library.fileManagement.enabled ||
                  !configToEdit.library.fileManagement.allowOwnershipTransfer}
                bind:checked={configToEdit.library.fileManagement.addAlbumEditor}
              />
              <SettingSelect
                options={sharedLinkPolicyOptions}
                disabled={disabled ||
                  !configToEdit.library.fileManagement.enabled ||
                  !configToEdit.library.fileManagement.allowOwnershipTransfer}
                name="library-shared-link-policy"
                label={$t('admin.library_move_shared_links')}
                desc={$t('admin.library_move_shared_links_description')}
                bind:value={configToEdit.library.fileManagement.sharedLinkPolicy}
              />
              <SettingSwitch
                title={$t('admin.library_move_faces')}
                subtitle={$t('admin.library_move_faces_description')}
                disabled={disabled ||
                  !configToEdit.library.fileManagement.enabled ||
                  !configToEdit.library.fileManagement.allowOwnershipTransfer}
                bind:checked={configToEdit.library.fileManagement.transferFaces}
              />
            </div>
          </SettingAccordion>
        {/if}

        <SettingButtonsRow bind:configToEdit keys={['library']} {disabled} />
      </div>
    </form>
  </div>
</div>
