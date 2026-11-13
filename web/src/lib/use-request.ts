import { useEffect, useState } from 'react';
import { api } from '../api';

export function useData<T>(
  url: string,
  revision: number,
  keepPrevious = false,
): { url: string; data?: T; error?: string; loading: boolean } {
  const [state, setState] = useState<{ url: string; revision: number; data?: T; error?: string }>({
    url: '',
    revision: -1,
  });
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    api<T>(url, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setState({ url, revision, data });
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted)
          setState({
            url,
            revision,
            error: err instanceof Error ? err.message : 'Could not load data. Try again.',
          });
      });
    return () => controller.abort();
  }, [url, revision]);
  return state.url === url && state.revision === revision
    ? { ...state, loading: false }
    : { url, data: keepPrevious && state.url === url ? state.data : undefined, loading: Boolean(url) };
}

/** Shared desk request lifecycle, including refresh and mutation feedback. */
export function usePageData<T>(url: string, externalRevision = 0) {
  const [revision, bump] = useState(0);
  const [actionError, setError] = useState<string | null>(null);
  const request = useData<T>(url, revision + externalRevision);
  useEffect(() => {
    setError(null);
  }, [url]);
  const refresh = () => {
    setError(null);
    bump((value) => value + 1);
  };
  return { ...request, error: actionError ?? request.error, setError, refresh };
}
