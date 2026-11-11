import { pollAdminProbe, type AdminProbeSignal } from '../../src/admin-probe';
import { ApiError, api, type Account } from './api';

/** Load the signed-in account, retrying transient session failures. Returns a cancel function. */
export function watchAdminAccount(onAccount: (account: Account) => void): () => void {
  const signal: AdminProbeSignal = { aborted: false };
  void pollAdminProbe((attempt) => fetchAccount(attempt), {
    signal,
    statusOf: (error) => (error instanceof ApiError ? error.status : null),
  }).then((account) => {
    if (account && !signal.aborted) onAccount(account);
  });
  return () => {
    signal.aborted = true;
  };
}

async function fetchAccount(attempt: number): Promise<Account> {
  const body = await api<{ account: Account }>('/api/admin/me', {}, { skipCache: attempt > 0, requireToken: true });
  return body.account;
}
