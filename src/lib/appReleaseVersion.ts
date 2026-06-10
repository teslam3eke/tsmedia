/** 由 vite define 注入；與 package.json `version`、build-id.txt、/api/git-sha 一致。 */
declare const __APP_VERSION__: string

export function appReleaseVersion(): string {
  return typeof __APP_VERSION__ === 'string' ? __APP_VERSION__.trim() : ''
}

/** 畫面顯示用，例如 v1.0.1 */
export function appReleaseVersionLabel(): string {
  const v = appReleaseVersion()
  return v ? `v${v}` : ''
}
