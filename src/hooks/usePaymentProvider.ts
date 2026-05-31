import { useEffect, useState } from 'react'
import { fetchPaymentProvider, type PaymentProviderMode } from '@/lib/paymentProvider'

export function usePaymentProvider() {
  const [mode, setMode] = useState<PaymentProviderMode>('mock')
  const [sandbox, setSandbox] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const state = await fetchPaymentProvider()
      if (cancelled) return
      setMode(state.mode)
      setSandbox(state.sandbox)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return { mode, sandbox, loading }
}
