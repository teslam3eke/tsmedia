import { iosOrIpadosLikely, standaloneDisplayModeLikely } from '@/lib/resumeHardReload'

export function readPwaStandaloneMode(): boolean {
  return standaloneDisplayModeLikely()
}

/** iOS／iPadOS 且非「加入主畫面」封裝：須重新走安全檢測與封裝引導。 */
export function needsPwaEncapsulationGate(): boolean {
  return iosOrIpadosLikely() && !readPwaStandaloneMode()
}
