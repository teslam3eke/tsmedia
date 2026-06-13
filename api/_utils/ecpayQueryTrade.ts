import { buildCheckMacValue, verifyCheckMacValue } from './ecpayCrypto.js'
import type { EcpayConfig } from './ecpayConfig.js'

function parseFormBody(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of new URLSearchParams(text)) {
    out[k] = v
  }
  return out
}

/** 綠界 QueryTradeInfo：查詢 AIO 訂單是否已付款（notify／return 漏接時補入帳用） */
export async function queryEcpayTrade(
  cfg: Pick<EcpayConfig, 'merchantId' | 'hashKey' | 'hashIV' | 'sandbox'>,
  merchantTradeNo: string,
): Promise<{ ok: true; body: Record<string, string> } | { ok: false; error: string }> {
  const queryUrl = cfg.sandbox
    ? 'https://payment-stage.ecpay.com.tw/Cashier/QueryTradeInfo/V5'
    : 'https://payment.ecpay.com.tw/Cashier/QueryTradeInfo/V5'

  const params: Record<string, string> = {
    MerchantID: cfg.merchantId,
    MerchantTradeNo: merchantTradeNo,
    TimeStamp: String(Math.floor(Date.now() / 1000)),
  }
  params.CheckMacValue = buildCheckMacValue(params, cfg.hashKey, cfg.hashIV)

  let res: Response
  try {
    res = await fetch(queryUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    })
  } catch (e) {
    console.error('[ecpay] query trade network', merchantTradeNo, e)
    return { ok: false, error: '無法連線至綠界查詢' }
  }

  const text = await res.text()
  const body = parseFormBody(text)

  if (body.RtnCode !== '1') {
    return { ok: false, error: body.RtnMsg || '綠界查詢失敗' }
  }

  if (!verifyCheckMacValue(body, cfg.hashKey, cfg.hashIV)) {
    console.warn('[ecpay] query trade CheckMacValue mismatch', merchantTradeNo)
    return { ok: false, error: '綠界查詢回應驗簽失敗' }
  }

  return { ok: true, body }
}

/** TradeStatus=1 表示已付款（信用卡 AIO） */
export function isEcpayTradePaid(body: Record<string, string>): boolean {
  return body.TradeStatus?.trim() === '1'
}
