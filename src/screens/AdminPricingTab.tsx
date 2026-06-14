import { useCallback, useEffect, useMemo, useState } from 'react'
import { Tag, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  cancelAdminPaymentPromoCampaign,
  createAdminPaymentPromoCampaign,
  getAdminPaymentPromoCampaigns,
  type PaymentPromoCampaignRow,
} from '@/lib/db'
import {
  formatDiscountTenthsZh,
  formatPromoEndsAtZhTw,
} from '@/lib/paymentPricing'

const DISCOUNT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const

function campaignStatus(row: PaymentPromoCampaignRow, now = Date.now()): 'active' | 'scheduled' | 'expired' | 'cancelled' {
  if (row.cancelled_at) return 'cancelled'
  const start = new Date(row.starts_at).getTime()
  const end = new Date(row.ends_at).getTime()
  if (end <= now) return 'expired'
  if (start > now) return 'scheduled'
  return 'active'
}

const STATUS_LABEL: Record<ReturnType<typeof campaignStatus>, string> = {
  active: '進行中',
  scheduled: '尚未開始',
  expired: '已到期',
  cancelled: '已取消',
}

function defaultEndsAtLocalInput(): string {
  const d = new Date()
  d.setDate(d.getDate() + 30)
  d.setHours(23, 59, 0, 0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function localInputToTaipeiIso(localValue: string): string | null {
  if (!localValue) return null
  const d = new Date(localValue)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

export default function AdminPricingTab() {
  const [rows, setRows] = useState<PaymentPromoCampaignRow[]>([])
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [label, setLabel] = useState('試營運特價')
  const [discountTenths, setDiscountTenths] = useState<number>(2)
  const [endsAtLocal, setEndsAtLocal] = useState(defaultEndsAtLocalInput)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const data = await getAdminPaymentPromoCampaigns()
    setRows(data)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const activeCampaign = useMemo(
    () => rows.find((row) => campaignStatus(row) === 'active') ?? null,
    [rows],
  )

  const handleCreate = async () => {
    setError(null)
    setSuccess(null)
    const endsAtIso = localInputToTaipeiIso(endsAtLocal)
    if (!label.trim()) {
      setError('請輸入特價文宣')
      return
    }
    if (!endsAtIso || new Date(endsAtIso).getTime() <= Date.now()) {
      setError('到期日須晚於現在')
      return
    }
    setActing('create')
    const res = await createAdminPaymentPromoCampaign({
      label: label.trim(),
      discountTenths,
      endsAtIso,
    })
    setActing(null)
    if (!res.ok) {
      setError(res.error ?? '建立失敗')
      return
    }
    setSuccess(`已建立特價：${label.trim()} · ${formatDiscountTenthsZh(discountTenths)}`)
    void load()
  }

  const handleCancel = async (id: string) => {
    if (!window.confirm('確定要提前結束此特價活動？結束後將恢復原價。')) return
    setActing(id)
    setError(null)
    setSuccess(null)
    const res = await cancelAdminPaymentPromoCampaign(id)
    setActing(null)
    if (!res.ok) {
      setError(res.error ?? '取消失敗')
      return
    }
    setSuccess('特價已提前結束')
    void load()
  }

  return (
    <div className="space-y-4 pb-8">
      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
        <div className="flex items-center gap-2 mb-3">
          <Tag className="w-4 h-4 text-amber-600" />
          <h2 className="text-sm font-black text-slate-900">新增特價活動</h2>
        </div>
        <p className="text-xs leading-relaxed text-slate-500 mb-4">
          建立後立即生效，套用至全站付費商品（VIP 月卡與加購道具）。到期後自動恢復原價；若與現有進行中活動重疊，以最新建立者為準。
        </p>

        <label className="block text-xs font-bold text-slate-600 mb-1">特價文宣</label>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="例：試營運特價"
          maxLength={40}
          className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-900 outline-none focus:ring-2 focus:ring-amber-400/40"
        />

        <label className="block text-xs font-bold text-slate-600 mt-3 mb-1">折扣成數</label>
        <select
          value={discountTenths}
          onChange={(e) => setDiscountTenths(Number(e.target.value))}
          className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-900 outline-none focus:ring-2 focus:ring-amber-400/40"
        >
          {DISCOUNT_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {formatDiscountTenthsZh(t)}
              {t === 10 ? '（原價）' : ''}
            </option>
          ))}
        </select>

        <label className="block text-xs font-bold text-slate-600 mt-3 mb-1">到期日（台北時間）</label>
        <input
          type="datetime-local"
          value={endsAtLocal}
          onChange={(e) => setEndsAtLocal(e.target.value)}
          className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-900 outline-none focus:ring-2 focus:ring-amber-400/40"
        />

        <button
          type="button"
          disabled={acting === 'create'}
          onClick={() => void handleCreate()}
          className={cn(
            'mt-4 w-full rounded-xl py-3 text-sm font-black transition active:scale-[0.99]',
            acting === 'create' ? 'bg-slate-200 text-slate-500' : 'bg-amber-500 text-white',
          )}
        >
          {acting === 'create' ? '建立中⋯' : '建立特價'}
        </button>

        {error && (
          <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{error}</p>
        )}
        {success && (
          <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">{success}</p>
        )}
      </div>

      {activeCampaign && (
        <div className="rounded-2xl bg-amber-50 px-4 py-3 ring-1 ring-amber-200">
          <p className="text-xs font-bold text-amber-900">目前進行中</p>
          <p className="mt-1 text-sm font-black text-amber-950">
            {activeCampaign.label} · {formatDiscountTenthsZh(activeCampaign.discount_tenths)}
          </p>
          <p className="mt-1 text-xs font-semibold text-amber-800">
            至 {formatPromoEndsAtZhTw(activeCampaign.ends_at)}
          </p>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">活動紀錄</h3>
        <button
          type="button"
          onClick={() => void load()}
          className="flex items-center gap-1 text-xs font-bold text-slate-500"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
          重新整理
        </button>
      </div>

      {loading && rows.length === 0 ? (
        <p className="text-center text-sm text-slate-400 py-8">載入中⋯</p>
      ) : rows.length === 0 ? (
        <p className="text-center text-sm text-slate-400 py-8">尚無特價紀錄</p>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => {
            const status = campaignStatus(row)
            return (
              <div key={row.id} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-black text-slate-900 truncate">{row.label}</p>
                    <p className="mt-0.5 text-xs font-semibold text-slate-600">
                      {formatDiscountTenthsZh(row.discount_tenths)} · 至 {formatPromoEndsAtZhTw(row.ends_at)}
                    </p>
                    <p className="mt-1 text-[10px] font-bold text-slate-400">
                      建立 {formatPromoEndsAtZhTw(row.created_at)}
                    </p>
                  </div>
                  <span
                    className={cn(
                      'shrink-0 rounded-lg px-2 py-1 text-[10px] font-black',
                      status === 'active' && 'bg-emerald-100 text-emerald-800',
                      status === 'scheduled' && 'bg-sky-100 text-sky-800',
                      status === 'expired' && 'bg-slate-100 text-slate-600',
                      status === 'cancelled' && 'bg-red-100 text-red-700',
                    )}
                  >
                    {STATUS_LABEL[status]}
                  </span>
                </div>
                {status === 'active' && (
                  <button
                    type="button"
                    disabled={acting === row.id}
                    onClick={() => void handleCancel(row.id)}
                    className="mt-3 w-full rounded-xl bg-slate-100 py-2 text-xs font-black text-slate-700 active:bg-slate-200"
                  >
                    {acting === row.id ? '處理中⋯' : '提前結束特價'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
