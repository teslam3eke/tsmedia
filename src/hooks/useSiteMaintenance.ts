import { useCallback, useEffect, useState } from 'react'
import { fetchSitePublicStatus } from '@/lib/siteMaintenance'

export function useSiteMaintenance() {
  const [maintenance, setMaintenance] = useState<boolean | null>(null)

  const refresh = useCallback(async () => {
    const status = await fetchSitePublicStatus()
    setMaintenance(status.maintenance)
  }, [])

  useEffect(() => {
    void refresh()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [refresh])

  return {
    maintenance: maintenance === true,
    loading: maintenance === null,
    refresh,
  }
}
