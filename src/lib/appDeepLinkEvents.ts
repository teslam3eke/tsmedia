/** SW／主程式：推播開啟時套 deep link（不依賴 `WindowClient.navigate` SPA 不可靠） */
export const TM_APP_DEEP_LINK_EVENT = 'tm_app_deep_link'

/** SW 前景抑制 OS 橫幅後，帶完整 notification payload 觸發站內彈窗 */
export const TM_APP_NOTIF_FOREGROUND_EVENT = 'tm_app_notif_foreground'

/** Realtime teardown 可能卡在 buffer；回前景先打 REST 預熱再硬斷 WS，並通知主殼刷新（勿等 onOpen） */
export const TM_FOREGROUND_TRANSPORT_KICK_EVENT = 'tm_foreground_transport_kick'

/**
 * `removeAllChannels()` 後延遲重綁：MainScreen 遞增 nonce，讓 `subscribeToNewMatches`／`subscribeToMatchMessages` 走新的 channel。
 */
export const TM_PHYSICAL_CHANNEL_RESUBSCRIBE_EVENT = 'tm_physical_channel_resubscribe'
