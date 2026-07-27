/** YouTube／廣告落地頁等行銷專用路徑（非首頁 `/`）。 */

export function pathnameIsJoin(pathname: string): boolean {
  const path = pathname.replace(/\/$/, '') || '/'
  return path === '/join' || path.endsWith('/join')
}

/** 目前網址是否在 `/join` 廣告落地頁 */
export function isOnJoinRoute(): boolean {
  if (typeof window === 'undefined') return false
  return pathnameIsJoin(window.location.pathname)
}
