/* eslint-disable @typescript-eslint/no-explicit-any */
import axios, { AxiosRequestConfig } from 'axios';
import * as endpoints from './api-endpoints';

const REDIRECT_PARAM = 'redirect_to';
const LOGIN_PATH_RE = /(?:^|\/)login(?:\/|$)/;
const CALLER_HANDLED_AUTH_PATHS = ['/api/auth/login', '/api/auth/apikey-login'];

function requestUrlIncludes(url: string | undefined, path: string): boolean {
  return url?.includes(path) === true;
}

function shouldCallerHandleAuthError(url: string | undefined): boolean {
  return (
    requestUrlIncludes(url, '/api/auth/2fa') ||
    requestUrlIncludes(url, '/api/auth/logout') ||
    CALLER_HANDLED_AUTH_PATHS.some((path) => requestUrlIncludes(url, path))
  );
}

function loginRedirectUrl(): string {
  const loginPage = endpoints.loginPage();
  const { pathname, search, hash } = window.location;
  if (LOGIN_PATH_RE.test(pathname)) {
    return loginPage;
  }
  const currentPath = `${pathname}${search}${hash}` || '/';
  const separator = loginPage.includes('?') ? '&' : '?';
  return `${loginPage}${separator}${REDIRECT_PARAM}=${encodeURIComponent(currentPath)}`;
}

async function _get<T>(url: string, options?: AxiosRequestConfig): Promise<T> {
  const response = await axios.get(url, { ...options });
  return response.data;
}

async function _getResponse<T>(url: string, options?: AxiosRequestConfig): Promise<T> {
  return await axios.get(url, { ...options });
}

async function _post(url: string, data?: any, options?: AxiosRequestConfig) {
  const response = await axios.post(url, JSON.stringify(data), {
    ...options,
    headers: {
      ...(options?.headers ?? {}),
      'Content-Type': 'application/json',
    },
  });
  return response.data;
}

async function _postMultiPart(url: string, formData: FormData, options?: AxiosRequestConfig) {
  const response = await axios.post(url, formData, {
    ...options,
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
}

async function _postTTS(url: string, formData: FormData, options?: AxiosRequestConfig) {
  const response = await axios.post(url, formData, {
    ...options,
    headers: { 'Content-Type': 'multipart/form-data' },
    responseType: 'arraybuffer',
  });
  return response.data;
}

async function _put(url: string, data?: any, options?: AxiosRequestConfig) {
  const response = await axios.put(url, JSON.stringify(data), {
    ...options,
    headers: {
      ...(options?.headers ?? {}),
      'Content-Type': 'application/json',
    },
  });
  return response.data;
}

async function _delete<T>(url: string, options?: AxiosRequestConfig): Promise<T> {
  const response = await axios.delete(url, { ...options });
  return response.data;
}

async function _deleteWithOptions<T>(url: string, options?: AxiosRequestConfig): Promise<T> {
  const response = await axios.delete(url, { ...options });
  return response.data;
}

async function _patch(url: string, data?: any, options?: AxiosRequestConfig) {
  const response = await axios.patch(url, JSON.stringify(data), {
    ...options,
    headers: {
      ...(options?.headers ?? {}),
      'Content-Type': 'application/json',
    },
  });
  return response.data;
}

if (typeof window !== 'undefined') {
  axios.interceptors.response.use(
    (response) => response,
    (error) => {
      const originalRequest = error.config;
      if (!error.response) {
        return Promise.reject(error);
      }
      if (shouldCallerHandleAuthError(originalRequest?.url)) {
        return Promise.reject(error);
      }
      // Credential-attempt endpoints return 401 for wrong credentials / unverified
      // accounts. That's an expected auth-flow error the login UI shows inline —
      // it must NOT be treated as session-expiry, which hard-redirects to the
      // login page (a full page reload that wipes the error, so a failed sign-in
      // looks like "nothing happened, the page just refreshed"). Let the caller's
      // onError handle it.
      const authAttemptPaths = ['/api/auth/signin', '/api/auth/apikey-login', '/api/auth/signup'];
      if (authAttemptPaths.some((path) => originalRequest?.url?.includes(path) === true)) {
        return Promise.reject(error);
      }

      if (error.response.status === 401 && !window.location.href.includes('share/')) {
        window.location.href = loginRedirectUrl();
      }
      return Promise.reject(error);
    },
  );
}

export default {
  get: _get,
  getResponse: _getResponse,
  post: _post,
  postMultiPart: _postMultiPart,
  postTTS: _postTTS,
  put: _put,
  delete: _delete,
  deleteWithOptions: _deleteWithOptions,
  patch: _patch,
};
