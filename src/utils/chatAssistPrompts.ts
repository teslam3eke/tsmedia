/** 配對聊天輔助問答題庫（各填各的；題幹用「你」） */

export type ChatAssistCategory = 'scenario' | 'creative' | 'warm'

export interface ChatAssistPrompt {
  id: string
  category: ChatAssistCategory
  text: string
}

export const CHAT_ASSIST_PROMPTS: ChatAssistPrompt[] = [
  // 情境型 P1–P9（P10 已刪）
  { id: 'P1', category: 'scenario', text: '荒島 7 天只能帶 3 樣（不含人），你會帶什麼？原因？' },
  { id: 'P2', category: 'scenario', text: '這輩子只能吃 3 種食物，你選哪三樣？原因？' },
  { id: 'P3', category: 'scenario', text: '你的快樂三件套是什麼？原因？' },
  { id: 'P4', category: 'scenario', text: '你理想的一次約會會怎麼安排？原因？' },
  { id: 'P5', category: 'scenario', text: '若只留 3 段人生回憶，你會留哪些？原因？' },
  { id: 'P6', category: 'scenario', text: '書架只能留 1 本書，你選哪一本？原因？' },
  { id: 'P7', category: 'scenario', text: '你最愛的三道菜是什麼？原因？' },
  { id: 'P8', category: 'scenario', text: '你的約會歌單只能 3 首，哪三首？原因？' },
  { id: 'P9', category: 'scenario', text: '興趣裝備只能留 3 樣，你留哪三樣？原因？' },
  // 創意 C1–C40（C30 已刪）
  { id: 'C1', category: 'creative', text: '若你有超能力，你希望會是什麼？原因？' },
  { id: 'C2', category: 'creative', text: '若你開一間週五限定的小酒吧，店名與三條店規會是？原因？' },
  { id: 'C3', category: 'creative', text: '用幾個影劇角色形容你現在的狀態。原因？' },
  { id: 'C4', category: 'creative', text: '你想瞬間學會哪種才藝？原因？' },
  { id: 'C5', category: 'creative', text: '你比較像晴天派還是雨天派？原因？' },
  { id: 'C6', category: 'creative', text: '若聊天是合奏，你是什麼樂器？原因？' },
  { id: 'C7', category: 'creative', text: '「專屬約會日」這天必做的一件事？原因？' },
  { id: 'C8', category: 'creative', text: '你理想的週日下午會怎麼過？原因？' },
  { id: 'C9', category: 'creative', text: '若你是動物園裡的一種動物，會是什麼？原因？' },
  { id: 'C10', category: 'creative', text: '200 元、30 分鐘約會，你怎麼排？原因？' },
  { id: 'C11', category: 'creative', text: '送一個「魔法道具」度過本週，是什麼？原因？' },
  { id: 'C12', category: 'creative', text: '你最近在追什麼（影集、書、遊戲、音樂皆可）？原因？' },
  { id: 'C13', category: 'creative', text: '用幾種氣味形容你的個性。原因？' },
  { id: 'C14', category: 'creative', text: '最近哪個週末過得讓你印象很深？原因？' },
  { id: 'C15', category: 'creative', text: '只有你懂的暗號，代表「我想你了」。原因？' },
  { id: 'C16', category: 'creative', text: '荒謬但做得到的人生清單，提一項。原因？' },
  { id: 'C17', category: 'creative', text: '你像哪種甜點？原因？' },
  { id: 'C18', category: 'creative', text: '聊天室背景音，你這週想放什麼？原因？' },
  { id: 'C19', category: 'creative', text: '若下週要見面，你的開場白＋結尾語會是？原因？' },
  { id: 'C20', category: 'creative', text: '你這段生活像哪種電影類型？原因？' },
  { id: 'C21', category: 'creative', text: '若你當一天店長：店名、賣什麼、三條店規？原因？' },
  { id: 'C22', category: 'creative', text: '用 emoji 串起你最近一件小事。原因？' },
  { id: 'C23', category: 'creative', text: '你最近的生活節奏偏快還是偏慢？原因？' },
  { id: 'C24', category: 'creative', text: '若可以瞬移去吃一餐：台灣哪裡、吃什麼？原因？' },
  { id: 'C25', category: 'creative', text: '今天若只能拍一張照片，你會拍什麼？原因？' },
  { id: 'C26', category: 'creative', text: '若用一種顏色形容你今天的狀態，會是什麼？原因？' },
  { id: 'C27', category: 'creative', text: '若規劃半日約會路線，路線名稱與會去的三個地點？原因？' },
  { id: 'C28', category: 'creative', text: '若多一個小時完全屬於你的時間，你會做什麼？原因？' },
  { id: 'C29', category: 'creative', text: '若你上綜藝節目，最適合哪一種？原因？' },
  { id: 'C31', category: 'creative', text: '只能問一個不能閃避的問題，你問什麼？原因？' },
  { id: 'C32', category: 'creative', text: '若用天氣形容你這週，會是怎樣？原因？' },
  { id: 'C33', category: 'creative', text: '若是同桌同學，第一堂課選什麼科目？原因？' },
  { id: 'C34', category: 'creative', text: '設計一句你喜歡收到的讚美，並寫範例。原因？' },
  { id: 'C35', category: 'creative', text: '給過去的自己一則短訊，寫什麼？原因？' },
  { id: 'C36', category: 'creative', text: '想像中的寵物：名字、長相、個性。原因？' },
  { id: 'C37', category: 'creative', text: '用幾種聲音形容你的個性。原因？' },
  { id: 'C38', category: 'creative', text: '若你有搭檔組合，組名＋ slogan 會是？原因？' },
  { id: 'C39', category: 'creative', text: '發明一個今天必完成的迷你任務。原因？' },
  { id: 'C40', category: 'creative', text: '若約會可以天馬行空一點，你會怎麼安排？原因？' },
  // 好聊 W1–W16
  { id: 'W1', category: 'warm', text: '分享一個小偏好（超愛、超怕或超討厭）。原因？' },
  { id: 'W2', category: 'warm', text: '這週哪個瞬間最代表現在的你？用一句話描述。原因？' },
  { id: 'W3', category: 'warm', text: '用三個形容詞形容現在的你。原因？' },
  { id: 'W4', category: 'warm', text: '出個二選一題，連問題帶你的選擇寫在回答裡。原因？' },
  { id: 'W5', category: 'warm', text: '最近想嘗試但還沒開始的一件事是什麼？原因？' },
  { id: 'W6', category: 'warm', text: '遇到新朋友時，你會用哪一句話開場（非聊工作）？原因？' },
  { id: 'W7', category: 'warm', text: '最近一件讓你開心或好笑的小事。原因？' },
  { id: 'W8', category: 'warm', text: '送不到 100 元的小禮物，你會送什麼？原因？' },
  { id: 'W9', category: 'warm', text: '若能重播一次，你選哪個週末片段？原因？' },
  { id: 'W10', category: 'warm', text: '用一句話形容你這週的狀態。原因？' },
  { id: 'W11', category: 'warm', text: '你覺得自己算是內向還是外向？原因？' },
  { id: 'W12', category: 'warm', text: '你平常怎麼放鬆？原因？' },
  { id: 'W13', category: 'warm', text: '你猜自己這週末會做的一件事。原因？' },
  { id: 'W14', category: 'warm', text: '剩 12 小時正常時光，你想做哪三件事？原因？' },
  { id: 'W16', category: 'warm', text: '你最近最期待的一件事是什麼？原因？' },
]

const PROMPT_BY_ID = new Map(CHAT_ASSIST_PROMPTS.map((p) => [p.id, p]))

export function getChatAssistPrompt(id: string): ChatAssistPrompt | undefined {
  return PROMPT_BY_ID.get(id)
}

export function pickChatAssistPromptId(seed: string): string {
  let h = 2166136261
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  const idx = (h >>> 0) % CHAT_ASSIST_PROMPTS.length
  return CHAT_ASSIST_PROMPTS[idx]!.id
}
