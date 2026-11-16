import { asMutation } from '#lib/queries/client.ts';
import { runAssetJobs } from '@immich/sdk';

export const runAssetJobsMutation = () =>
  asMutation(runAssetJobs, { meta: { error: { toast: 'errors.unable_to_submit_job' } } });
