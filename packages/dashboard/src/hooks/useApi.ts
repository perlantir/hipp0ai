import { useCallback } from 'react';

export interface ApiError {
  status: number;
  message: string;
}

export function useApi() {
  const baseUrl = import.meta.env.VITE_API_URL || '';

  const request = useCallback(
    async <T>(method: string, path: string, body?: unknown): Promise<T> => {
      const url = `${baseUrl}${path}`;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      // Optional API key — set from DevTools with
      //   localStorage.setItem('hipp0_api_key', '<your HIPP0_API_KEY>')
      // Works against self-hosted Hipp0 servers that have
      // HIPP0_AUTH_REQUIRED=true. No-op when unset.
      try {
        const apiKey = localStorage.getItem('hipp0_api_key');
        if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      } catch { /* storage unavailable — ignore */ }

      const options: RequestInit = { method, headers };

      if (body !== undefined) {
        options.body = JSON.stringify(body);
      }

      const response = await fetch(url, options);

      if (!response.ok) {
        const errorBody = await response.text();
        let message: string;
        try {
          const parsed = JSON.parse(errorBody);
          message = parsed.error?.message || parsed.message || (typeof parsed.error === 'string' ? parsed.error : errorBody);
        } catch {
          message = errorBody || response.statusText;
        }
        throw { status: response.status, message } as ApiError;
      }

      if (response.status === 204) {
        return undefined as T;
      }

      return response.json();
    },
    [baseUrl],
  );

  const get = useCallback(<T>(path: string): Promise<T> => request<T>('GET', path), [request]);

  const post = useCallback(
    <T>(path: string, body: unknown): Promise<T> => request<T>('POST', path, body),
    [request],
  );

  const patch = useCallback(
    <T>(path: string, body: unknown): Promise<T> => request<T>('PATCH', path, body),
    [request],
  );

  const del = useCallback(
    (path: string): Promise<void> => request<void>('DELETE', path),
    [request],
  );

  return { get, post, patch, del, baseUrl };
}
