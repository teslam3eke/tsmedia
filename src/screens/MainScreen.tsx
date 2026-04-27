import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Heart, X, MessageCircle, Compass, User,
  Sparkles, MapPin, Briefcase, GraduationCap,
  ChevronLeft, ChevronDown, Send, Bell, BellOff,
  Cpu, Zap, LogOut, MessageSquare, Check, Pencil,
  Camera, Trash2, ImageIcon, Users, Star,
  Search, Plus, Smile, BellRing, AlertCircle, Gem,
  FileText, Upload, ShieldCheck, ChevronRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { signOut } from '@/lib/auth'
import {
  getProfile, resolvePhotoUrls, upsertProfile, uploadPhoto, getIncomeVerification,
  uploadProofDoc, submitVerificationDoc, submitIncomeVerification,
  getUnreadAppNotifications, markAppNotificationRead,
  getTodayVerificationSubmissionCount, finalizeDueAiReviews,
  recordProfileInteraction,
} from '@/lib/db'
import type { ProfileRow, QuestionnaireEntry, Region, IncomeTier, Company, AiConfidence, AppNotificationRow } from '@/lib/types'
import { REGION_LABELS, INCOME_TIER_META } from '@/lib/types'
import { IncomeBorder } from '@/components/IncomeBorder'
import AdminScreen from '@/screens/AdminScreen'

// ─── Hardcore-answer heuristic ───────────────────────────────────────────────
// "機車題挑戰" cards show a tiny diamond icon after particularly assertive
// answers. We detect that with a short keyword list — feels direct without
// needing the user to tag answers manually.
const HARDCORE_MARKERS = [
  '絕對', '硬核', '絕不', '我付', '當然', '肯定', '一定', '必須', '毫不', '不可能', '死都', '最硬',
]
const AI_REVIEW_SECONDS = 15

function toIncomeTier(value: unknown): IncomeTier | null {
  return value === 'silver' || value === 'gold' || value === 'diamond' ? value : null
}
function isHardcoreAnswer(answer: string): boolean {
  if (!answer) return false
  return HARDCORE_MARKERS.some((kw) => answer.includes(kw))
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface QA {
  question: string
  answer: string
}

interface Profile {
  id: number
  gender: 'male' | 'female'
  name: string
  age: number
  company: string
  role: string
  department: string
  location: string
  education: string
  bio: string
  interests: string[]
  initials: string
  gradientFrom: string
  gradientTo: string
  compatScore: number
  photoUrl?: string
  qa: QA[]
  workRegion: 'north' | 'central' | 'south' | 'east'
  homeRegion: 'north' | 'central' | 'south' | 'east'
  incomeTier?: IncomeTier
  showIncomeBorder?: boolean
  userId?: string
}

type Tab = 'discover' | 'matches' | 'messages' | 'profile'

// ─── Data ─────────────────────────────────────────────────────────────────────

// ── Female profiles (shown to male users) ─────────────────────────────────
// ── Male profiles (shown to female users) ─────────────────────────────────
const PROFILES: Profile[] = [
  // ─── FEMALE ───────────────────────────────────────────────────────────────
  {
    id: 1,
    gender: 'female',
    name: '林子晴',
    age: 29,
    company: '台大醫院',
    role: '內科住院醫師',
    department: '一般內科',
    location: '台北',
    education: '台大醫學系',
    bio: '用科學解釋身體，用生活滋養靈魂。值班之外喜歡爬山、讀詩集，偶爾下廚煮一頓讓自己開心的飯。',
    interests: ['登山', '詩集', '下廚', '底片攝影'],
    initials: '林',
    gradientFrom: '#334155',
    gradientTo: '#475569',
    compatScore: 97,
    workRegion: 'north',
    homeRegion: 'north',
    incomeTier: 'diamond',
    showIncomeBorder: true,
    photoUrl: 'https://images.unsplash.com/photo-1529232356377-57971f020a94?w=600&h=900&fit=crop&q=80',
    qa: [
      { question: '你跟男友 AA，但每次結帳你都感覺有點尷尬。你認為這個尷尬，是誰的問題？', answer: '我覺得是我自己的問題。我在某個時刻還是殘留著「男生應該買單」的期待——但我不承認。一旦我搞清楚自己其實喜歡他主動付，那個尷尬就消失了。' },
      { question: '你的成就或收入超越男友了。你有沒有在關係裡刻意低調過這件事？為什麼？', answer: '有過，但現在不會了。那時候我怕他有壓力，就避開不聊薪水。後來我發現刻意低調比直接說更傷感情——那等於是在說「我不相信你能承受這個事實」。' },
      { question: '你下班後還在處理工作的事，男友說「妳的工作比我重要嗎？」你怎麼回應？', answer: '我會說：「這不是重要性的比較，這是我的責任。」但如果他一直這樣問，那要聊的不是那件事，是他的安全感從哪裡來。' },
      { question: '你有沒有在感情裡，為了「不想失去他」，接受了一些其實不應該接受的事情？', answer: '有。當時告訴自己「這沒什麼大不了」，但其實是怕開口。後來才知道，那些沒說出口的底線，才是讓一段關係慢慢變質的原因。' },
      { question: '有人說「妳太強了，男生會有壓力」——你覺得這句話是讚美、警告，還是藉口？', answer: '藉口。我不打算為了讓別人舒服而縮小自己。如果一個人真的因為我「太強」而退縮，那他也不是我在找的人。' },
    ],
  },
  {
    id: 3,
    gender: 'female',
    name: '吳思妤',
    age: 26,
    company: '自由接案',
    role: '品牌設計師',
    department: '品牌識別與視覺',
    location: '台北',
    education: '實踐大學設計學院',
    bio: '替品牌說故事是我的工作，替自己找故事是我的嗜好。喜歡台南的步調、冷門電影、和一個人騎單車迷路。',
    interests: ['品牌設計', '單車', '台灣電影', '植物'],
    initials: '吳',
    gradientFrom: '#064e3b',
    gradientTo: '#065f46',
    compatScore: 91,
    workRegion: 'north',
    homeRegion: 'south',
    incomeTier: 'gold',
    showIncomeBorder: true,
    photoUrl: 'https://images.unsplash.com/photo-1600481176431-47ad2ab2745d?w=600&h=900&fit=crop&q=80',
    qa: [
      { question: '有人說「嫁給有錢人比工作更有效率」，你怎麼看？你有沒有在某一刻覺得這句話有道理？', answer: '有，大概是某次接案接到凌晨兩點的時候。但那是疲憊的念頭，不是我真正的價值觀。用婚姻換取穩定，代價是你再也不知道自己憑自己能走多遠。' },
      { question: '你最近壓力很大，狀態很差。男友說「妳最近都不在狀態」。你的感受是什麼？', answer: '很複雜。一方面我理解他是想靠近我，另一方面我很想說「我光是站著就已經很努力了，你是想要什麼狀態？」我需要的是被支持，不是被提醒我不夠好。' },
      { question: '你父母需要用錢，你想動用兩人的共同存款，但男友有意見。你認為感情和孝順怎麼平衡？', answer: '我不認為這兩件事應該被放在天平上比較。但我也承認，如果一個人在這種時候猶豫，我會重新思考我們對「一起」的定義是不是相同的。' },
      { question: '你上一段感情結束的真正原因是什麼？你在那段關係裡，學到了什麼關於自己的事？', answer: '表面是溝通不良，真正的原因是我一直在等對方先開口。我學到我習慣把需求藏起來，然後在沒被看見的時候生悶氣。這件事我後來花了很長時間改。' },
      { question: '如果可以重新選擇，你會走同一條人生路線嗎？為什麼？', answer: '會。雖然自由接案很不穩定，但我沒有在其他地方找到這種「這件事是我做的」的感覺。只是我現在比較清楚，工作是我人生的一部分，不是全部。' },
    ],
  },
  {
    id: 5,
    gender: 'female',
    name: '王雅婷',
    age: 27,
    company: '理律法律事務所',
    role: '律師',
    department: '商務訴訟部門',
    location: '台北',
    education: '台大法律系',
    bio: '在法庭上講邏輯，在生活裡找感性。喜歡旅行、獨立音樂和一個人去看展，偶爾需要一個讓我安靜下來的人。',
    interests: ['旅行', '獨立音樂', '展覽', '瑜伽'],
    initials: '王',
    gradientFrom: '#7c3aed',
    gradientTo: '#6d28d9',
    compatScore: 93,
    workRegion: 'north',
    homeRegion: 'north',
    photoUrl: 'https://images.unsplash.com/photo-1534751516642-a1af1ef26a56?w=600&h=900&fit=crop&q=80',
    qa: [
      { question: '你媽媽說「男生就是要會養女生，不然要幹嘛」。你認同她的想法嗎？', answer: '不完全認同，但我也沒有完全否定。我不需要被養，但我確實希望對方有能力照顧自己。一個連自己都顧不好的人，很難讓我安心。' },
      { question: '你的夢想機會需要你移居到另一個城市或國家，但男友不願意搬。你會怎麼做？', answer: '認真談過一次。如果他有具體的理由和替代方案，我願意一起想。但如果只是「我不想」，那我們對彼此支持的理解根本就不一樣，需要先把這個搞清楚。' },
      { question: '你有沒有在感情裡，為了「不想失去他」，接受了一些其實不應該接受的事情？', answer: '有，一件很小的事，但我記了很久。我沒說出口，他也沒問，然後那件事就變成我們之間一道很淺的裂縫。後來我才懂：說出來才是在乎這段關係。' },
      { question: '你對「結婚」這件事，是有所期待，還是其實有點恐懼？這個感受背後是什麼？', answer: '兩個都有。期待的是有一個真的屬於我們的生活，恐懼的是「如果搞砸了怎麼辦」。但仔細想想，那個恐懼不是對婚姻，是對選錯人。' },
      { question: '十年後，你最不希望自己成為哪種女人？這個答案，對你選擇伴侶有沒有影響？', answer: '最不希望是那種「為了維持關係，把很多事吞下去，最後忘了自己原來是什麼樣子」的人。這個答案對我選擇伴侶的影響非常直接——我需要一個讓我可以繼續做自己的人。' },
    ],
  },
  {
    id: 7,
    gender: 'female',
    name: '陳映晴',
    age: 25,
    company: 'Gogoro',
    role: 'UX 設計師',
    department: '產品體驗設計',
    location: '台北',
    education: '台科大工業設計系',
    bio: '設計是我思考世界的方式。下班喜歡去拍底片，週末逛二手市集，偶爾在咖啡廳角落畫速寫，對「好用又好看」有點執念。',
    interests: ['底片攝影', '二手市集', '速寫', '單車'],
    initials: '陳',
    gradientFrom: '#be185d',
    gradientTo: '#9d174d',
    compatScore: 95,
    workRegion: 'north',
    homeRegion: 'central',
    incomeTier: 'silver',
    showIncomeBorder: true,
    photoUrl: 'https://images.unsplash.com/photo-1616325629936-99a9013c29c6?w=600&h=900&fit=crop&q=80',
    qa: [
      { question: '你跟男友 AA，但每次結帳你都感覺有點尷尬。你認為這個尷尬，是誰的問題？', answer: '我覺得是「預期沒有說清楚」的問題。AA 就 AA，但如果心裡默默期待對方請，又不說，那才是真正的尷尬來源。我現在比較習慣直接講。' },
      { question: '工作越來越忙，你發現自己越來越少有「只屬於自己的時間」。你打算怎麼辦？', answer: '我已經開始保護週六上午了——不約會、不開會、只做想做的事。這不是自私，是讓我有辦法繼續愛別人的前提。' },
      { question: '你的夢想機會需要你移居到另一個城市或國家，但男友不願意搬。你會怎麼做？', answer: '我會先認真問他「為什麼不願意」，這個原因決定一切。是短期困難可以克服，還是根本的價值觀不同——兩件事的處理方式完全不一樣。' },
      { question: '你上一段感情結束的真正原因是什麼？你在那段關係裡，學到了什麼關於自己的事？', answer: '我太習慣把自己縮小來適應對方了。我學到：讓自己變小不叫包容，那叫失去。現在我對這件事非常敏感。' },
      { question: '有人說「妳太強了，男生會有壓力」——你覺得這句話是讚美、警告，還是藉口？', answer: '三種都有一點，但最多的是藉口。我現在的標準是：如果一個人對我說這句話，我會想「那你來不來得及跟上？」而不是「我要不要變弱一點」。' },
    ],
  },
  // ─── MALE ─────────────────────────────────────────────────────────────────
  {
    id: 2,
    gender: 'male',
    name: '陳宥翔',
    age: 30,
    company: 'MediaTek',
    role: 'SoC 架構設計師',
    department: '5G 晶片研發',
    location: '新竹',
    education: '清大電資所',
    bio: '設計晶片是我的語言，音樂是我的靈魂。爵士吉他手，業餘烘焙師。尋找能在深夜 deadline 後一起吃宵夜的人。',
    interests: ['爵士吉他', '手沖咖啡', '電影', '重訓'],
    initials: '陳',
    gradientFrom: '#312e81',
    gradientTo: '#4338ca',
    compatScore: 94,
    workRegion: 'north',
    homeRegion: 'north',
    photoUrl: 'https://images.unsplash.com/photo-1487309078313-fad80c3ec1e5?w=600&h=900&fit=crop&q=80',
    qa: [
      { question: '你存款 200 萬，她存款 10 萬。她說「我們的錢就是我們的錢」。你心裡的第一個念頭是什麼？', answer: '第一個念頭是：「我們什麼時候決定要這樣的？」不是不信任，而是這種話需要一個正式的共識，不能在聊天時順帶帶過就算數。' },
      { question: '深夜 12 點你還在 debug，她傳訊息問「你今晚幾點回來陪我？」你怎麼回？', answer: '「我不知道，但我想結束後打給你。」然後真的打。我不想給一個假的時間讓她等，但也不想讓她覺得我消失了。' },
      { question: '你犧牲三個月假日加班，終於升職了。她說「你這三個月根本不存在」。你覺得這句話公平嗎？', answer: '公平，但也不完全公平。她說的是事實，但「不存在」這三個字讓我有點受傷。我希望我們能聊的是「你需要什麼」，而不是「你做了什麼讓我難過」。' },
      { question: '你覺得「努力工作養家」算是一種對感情的付出，還是你告訴自己的理由？', answer: '兩者都有，要看比例。這確實是一種付出，但如果它變成你迴避陪伴的藉口，那就是在自欺欺人了。我試著對自己誠實。' },
      { question: '你認為「成熟的關係」長什麼樣子？你目前的狀態，距離你的答案還有多遠？', answer: '兩個人在一起，不需要扮演任何角色。目前的狀態嘛——還在學。主要是學怎麼在不舒服的時候開口說，而不是等對方猜。' },
    ],
  },
  {
    id: 4,
    gender: 'male',
    name: '張哲維',
    age: 32,
    company: 'MediaTek',
    role: 'AI 演算法工程師',
    department: 'APU 智慧運算',
    location: '新竹',
    education: '交大資工所',
    bio: '白天訓練模型，晚上做夢。喜歡思考技術之外的事，像是城市規劃和人類學。尋找能陪我認真看紀錄片的人。',
    interests: ['紀錄片', '城市規劃', '義式料理', '閱讀'],
    initials: '張',
    gradientFrom: '#4c1d95',
    gradientTo: '#6d28d9',
    compatScore: 89,
    workRegion: 'north',
    homeRegion: 'south',
    photoUrl: 'https://images.unsplash.com/photo-1611459293885-f8e692ab0356?w=600&h=900&fit=crop&q=80',
    qa: [
      { question: '你買了一支 NT$15 萬的錶，她說「這錢可以拿去付頭期款的」。她說的有道理嗎？', answer: '有道理，但我不打算聽。這支錶是我用三個月加班費存的，我認為偶爾為自己做一件事是合理的。如果她對每一筆個人消費都有意見，那我們對「個人自主」的理解不一樣。' },
      { question: '工作壓力大的時候，你的情緒會帶回家。你認為這是你需要處理的問題，還是對方應該理解的現實？', answer: '我的問題，但我希望對方能接住一下。理想是我能有意識地切換，但人不是機器。我現在在練習的是：至少讓她知道我今天狀況不好，而不是讓她去猜。' },
      { question: '同部門女同事很常找你聊工作，有時候到深夜。另一半問你「你們是不是有什麼？」你怎麼回應？', answer: '直接說清楚：沒有。但我也會問她，是什麼讓她這樣感覺。如果真的讓她不舒服，我可以調整邊界。但我不想在沒有做任何事的情況下，讓自己像在認罪。' },
      { question: '工作和感情同時出現重大危機，你只能先處理一個，你選哪個？為什麼？', answer: '感情。工作的問題通常可以等幾個小時，但感情裡有些時刻，如果你選擇缺席，那個缺席很難事後補救。當然，這個答案的前提是對方真的重要。' },
      { question: '你有沒有一個「內心底線」，是你從來不曾跟任何人說清楚的？', answer: '有，而且不只一個。我不擅長預先把底線說出來——通常是被踩到的時候才發現。我現在慢慢在練習把這些說出來，因為如果連我自己都不說，別人怎麼知道？' },
    ],
  },
  {
    id: 6,
    gender: 'male',
    name: '許庭安',
    age: 29,
    company: 'TSMC',
    role: 'EUV 設備工程師',
    department: '前段製程設備',
    location: '新竹',
    education: '陽明交大光電所',
    bio: '操控光的人。下班後的我是業餘天文愛好者，熱愛深夜在山上架設望遠鏡。宇宙讓人渺小，也讓人自由。',
    interests: ['天文觀測', '健行', '黑膠唱片', '清酒'],
    initials: '許',
    gradientFrom: '#1e3a5f',
    gradientTo: '#1e40af',
    compatScore: 88,
    workRegion: 'north',
    homeRegion: 'central',
    photoUrl: 'https://images.unsplash.com/photo-1720501828093-c792c10e3f0b?w=600&h=900&fit=crop&q=80',
    qa: [
      { question: '兩人存款剛好夠付頭期款，她卻堅持要先用這筆錢去環遊世界一年。你怎麼辦？', answer: '先認真聽她說這件事對她為什麼重要。如果只是「我想出去玩」，我可能會說不；如果是她有一個很具體的原因，那這個房子可以再等。但這件事我們需要達成真正的共識，不是一方讓步。' },
      { question: '你最近壓力很大，需要「一個人的空間」。但她認為這是你在疏遠她。誰比較需要調整？', answer: '我需要解釋清楚我需要的是什麼，她需要的是被告知「這不是因為你」。我以為沉默是在保護她，但她接收到的是冷漠。這個部分是我的功課。' },
      { question: '你在感情裡有沒有一個「底線」，是你從來不曾跟任何對象說清楚的？', answer: '有。我對「被比較」這件事非常敏感，不管是和前任比還是和別人比。我從來沒有直說，因為我覺得說出來好像我很玻璃心。但其實不說才是問題所在。' },
      { question: '你的 work-life balance 現在是幾比幾？你對這個比例是真的滿意，還是只是習慣了？', answer: '大概是 7:3。我說不上滿意，但「習慣了」也不完全對——我知道自己在犧牲什麼，我只是還在找一個不用放棄技術深度的出口。' },
      { question: '十年後你最不希望自己成為哪種人？這個答案，對你選擇伴侶有沒有影響？', answer: '最不希望成為那種「很成功但不知道自己為誰成功」的人。這個答案確實影響我對伴侶的選擇——我想找一個能讓我記住「我是為了什麼而努力」的人，而不只是一個替我加油的人。' },
    ],
  },
]

// Full Profile data for each match so PersonDetailView can render the exact
// same layout as the Discover card. Ids must match MATCH_META entries below.
const MATCH_PROFILES: Profile[] = [
  {
    id: 101,
    gender: 'female',
    name: '王雅婷',
    age: 31,
    company: '理律法律事務所',
    role: '律師',
    department: '金融與資本市場組',
    location: '台北',
    education: '台大法律系',
    bio: '法律人的工作是把混亂翻譯成秩序。下班想做相反的事——聽爵士、煮一碗很慢的湯、看一部沒有邏輯的電影。',
    interests: ['爵士樂', '義大利料理', '歐洲電影', '手沖咖啡'],
    initials: '王',
    gradientFrom: '#7c3aed',
    gradientTo: '#6d28d9',
    compatScore: 92,
    workRegion: 'north',
    homeRegion: 'north',
    incomeTier: 'gold',
    showIncomeBorder: true,
    photoUrl: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=600&h=900&fit=crop&q=80',
    qa: [
      { question: '你覺得愛情裡最被誤解的事情是什麼？',                  answer: '「我懂你」這三個字。大多數時候我們其實只是投射自己，真正的懂需要長期觀察、而且承認自己的偏見。' },
      { question: '你下班後還在處理工作的事，男友說「妳的工作比我重要嗎？」你怎麼回應？', answer: '這不是重要性的問題，是責任。我會把話題從「比較」拉回「時間分配」，然後真的去做，而不是只說。' },
      { question: '有什麼事情你很少跟人說，但對你影響很大？',             answer: '我在青少年時期花很多時間陪姐姐跑醫院。那段時間我學會怎麼在別人崩潰的時候穩住自己，也讓我對「溫柔」這件事很挑剔。' },
    ],
  },
  {
    id: 102,
    gender: 'male',
    name: '劉承恩',
    age: 32,
    company: 'TSMC',
    role: '製程研發工程師',
    department: '先進製程 3nm 研發',
    location: '新竹',
    education: '清大材料所',
    bio: '在 3nm 節點裡找世界的秩序。週末喜歡上山呼吸一下，相信有些事情只在稜線上才看得清楚。',
    interests: ['登山', '獨立書店', '威士忌', '露營'],
    initials: '劉',
    gradientFrom: '#0f766e',
    gradientTo: '#0d9488',
    compatScore: 88,
    workRegion: 'north',
    homeRegion: 'north',
    photoUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=600&h=900&fit=crop&q=80',
    qa: [
      { question: '你如何定義「一段健康的關係」？',                     answer: '兩個人都不需要為了維繫關係而縮小自己。可以吵架，但吵完以後彼此更清楚對方是誰。' },
      { question: '工作對你來說的意義是什麼？',                         answer: '是一個能證明自己還在進步的地方。我不覺得工作就是全部，但它是讓我維持敏銳的方式。' },
      { question: '你最近一次真的難過是什麼時候？',                     answer: '阿公走的那天。才發現自己一直以為還有時間——這件事教我別拖延對喜歡的人說的話。' },
    ],
  },
  {
    id: 103,
    gender: 'female',
    name: '蔡佩如',
    age: 29,
    company: 'MediaTek',
    role: '數位設計工程師',
    department: '數位 IP 設計',
    location: '新竹',
    education: '交大電子所',
    bio: '寫 Verilog 的時候最有條理，煮湯麵的時候最沒原則。喜歡看紀錄片，尤其是關於小鎮與老人的那種。',
    interests: ['紀錄片', '電子音樂', '手沖咖啡', '湯麵'],
    initials: '蔡',
    gradientFrom: '#b45309',
    gradientTo: '#d97706',
    compatScore: 90,
    workRegion: 'north',
    homeRegion: 'central',
    incomeTier: 'silver',
    showIncomeBorder: true,
    photoUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=600&h=900&fit=crop&q=80',
    qa: [
      { question: '你覺得自己最難相處的那一面是什麼？',                 answer: '我對「不誠實的舒服」很敏感。有人為了不讓氣氛尷尬說些模糊的場面話，我反而更不舒服——會一直追問，直到對方不得不攤牌。' },
      { question: '在感情裡，你最需要的是什麼？',                       answer: '是「不會消失」。不是每天轟轟烈烈，而是對方會在我需要他的那個瞬間還在。這對我比浪漫重要很多。' },
      { question: '如果可以改掉一個過去的決定，你會改嗎？',             answer: '不會。我以前很討厭自己走過的一些彎路，現在發現是那些彎路讓我看見某些人，做出某些選擇。改掉就不是我了。' },
    ],
  },
]

// Lightweight per-row metadata (last message / timestamp / unread count)
const MATCH_META: Record<number, { lastMessage: string; time: string; unread: number }> = {
  101: { lastMessage: '你也喜歡手沖嗎？我最近在練習 V60 ☕', time: '剛剛',    unread: 2 },
  102: { lastMessage: '週末要一起去陽明山嗎？',               time: '14 分鐘', unread: 0 },
  103: { lastMessage: '那部紀錄片我也很想看！',               time: '1 小時',  unread: 1 },
}

// Legacy shape used by existing MatchesTab — now derived from MATCH_PROFILES
const MATCHES = MATCH_PROFILES.map((p) => ({
  id: p.id,
  name: p.name,
  company: p.company,
  role: p.role,
  initials: p.initials,
  from: p.gradientFrom,
  to: p.gradientTo,
  ...MATCH_META[p.id],
}))

function findFullProfile(id: number): Profile | null {
  return [...PROFILES, ...MATCH_PROFILES].find((p) => p.id === id) ?? null
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function CompanyBadge({ company }: { company: string }) {
  const isTsmc = company === 'TSMC'
  const isMtk = company === 'MediaTek'
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide',
      isTsmc
        ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200 uppercase'
        : isMtk
          ? 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200 uppercase'
          : 'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
    )}>
      <Cpu className="w-2.5 h-2.5" />
      {company}
    </span>
  )
}

// ─── Discover Tab ─────────────────────────────────────────────────────────────

// ─── Notification Settings Modal ─────────────────────────────────────────────

type NotifKey = 'newMatch' | 'messages' | 'newProfile' | 'weeklyDigest'

interface NotifSettings {
  newMatch: boolean
  messages: boolean
  newProfile: boolean
  weeklyDigest: boolean
}

function NotificationModal({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<NotifSettings>(() => {
    const defaults: NotifSettings = { newMatch: false, messages: false, newProfile: false, weeklyDigest: false }
    try {
      const saved = localStorage.getItem('notif_settings')
      return saved ? { ...defaults, ...JSON.parse(saved) } : defaults
    } catch { return defaults }
  })

  // ── Browser notification permission state & test helpers ──────────────
  const supported = typeof window !== 'undefined' && 'Notification' in window
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(
    supported ? Notification.permission : 'unsupported'
  )
  const [testStatus, setTestStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [testError, setTestError] = useState<string>('')

  // Detect iOS Safari (not PWA) — Notification API exists only when installed to Home Screen on iOS
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent.toLowerCase() : ''
  const isIOS = /iphone|ipad|ipod/.test(ua)
  const isStandalone =
    typeof window !== 'undefined' &&
    (window.matchMedia('(display-mode: standalone)').matches ||
      // iOS pre-16.4 legacy flag
      (navigator as Navigator & { standalone?: boolean }).standalone === true)
  const iosNeedsInstall = isIOS && !isStandalone

  const requestPerm = async () => {
    if (!supported) return 'unsupported' as const
    try {
      const p = await Notification.requestPermission()
      setPermission(p)
      return p
    } catch {
      setPermission('denied')
      return 'denied' as const
    }
  }

  const fireTestNotification = async () => {
    setTestStatus('sending')
    setTestError('')
    try {
      if (!supported) {
        setTestStatus('error')
        setTestError(iosNeedsInstall
          ? '請先把 tsMedia 加到主畫面後再試'
          : '此瀏覽器不支援通知功能')
        return
      }
      let perm = Notification.permission
      if (perm === 'default') perm = await requestPerm() as NotificationPermission
      if (perm !== 'granted') {
        setTestStatus('error')
        setTestError('通知權限未允許，請到裝置設定開啟')
        return
      }
      const title = '測試通知'
      const body  = '如果你看到這則通知，代表通知功能運作正常 ✅'
      const options: NotificationOptions = {
        body,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag: 'tsmedia-test',
      }
      // Prefer service-worker notifications (required on iOS PWA & Android Chrome PWA)
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.ready
        await reg.showNotification(title, options)
      } else {
        new Notification(title, options)
      }
      setTestStatus('sent')
      setTimeout(() => setTestStatus('idle'), 2500)
    } catch (e) {
      setTestStatus('error')
      setTestError(e instanceof Error ? e.message : '發送失敗')
    }
  }

  const toggle = async (key: NotifKey) => {
    // Turning a toggle ON → ask for permission if we haven't yet
    if (!settings[key] && supported && Notification.permission === 'default') {
      await requestPerm()
    }
    setSettings((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      localStorage.setItem('notif_settings', JSON.stringify(next))
      return next
    })
  }

  const allOff = !Object.values(settings).some(Boolean)

  const items: { key: NotifKey; icon: React.ElementType; label: string; desc: string }[] = [
    { key: 'newMatch',      icon: Heart,    label: '新配對通知',   desc: '超級喜歡或配對成功時通知你' },
    { key: 'messages',      icon: MessageCircle, label: '新訊息通知', desc: '收到新訊息時通知你' },
    { key: 'newProfile',    icon: Users,    label: '新推薦通知',   desc: '有新的高契合度對象時通知你' },
    { key: 'weeklyDigest',  icon: Star,     label: '每週精選摘要', desc: '每週一匯總你的配對概況' },
  ]

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-[200] flex items-end justify-center"
      style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 340, damping: 38 }}
        className="w-full max-w-md bg-white rounded-t-3xl px-5 pt-5 pb-10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="w-10 h-1 rounded-full bg-slate-200 mx-auto mb-5" />

        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            {allOff ? <BellOff className="w-5 h-5 text-slate-400" /> : <Bell className="w-5 h-5 text-slate-800" />}
            <span className="text-[17px] font-bold text-slate-900">通知設定</span>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center">
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        {/* Permission status banner */}
        <div
          className={cn(
            'mb-4 p-3.5 rounded-2xl flex items-start gap-3',
            permission === 'granted'
              ? 'bg-emerald-50 ring-1 ring-emerald-100'
              : permission === 'denied'
              ? 'bg-red-50 ring-1 ring-red-100'
              : 'bg-amber-50 ring-1 ring-amber-100'
          )}
        >
          {permission === 'granted' ? (
            <BellRing className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className={cn('w-5 h-5 flex-shrink-0 mt-0.5', permission === 'denied' ? 'text-red-500' : 'text-amber-500')} />
          )}
          <div className="flex-1 min-w-0 text-[12px] leading-relaxed">
            {permission === 'granted' && <span className="text-emerald-800">已取得通知權限，你可以收到推播</span>}
            {permission === 'denied'  && <span className="text-red-700">通知被封鎖，請到裝置設定 → tsMedia → 通知 開啟</span>}
            {permission === 'default' && <span className="text-amber-800">尚未取得通知權限，開啟任一項目或點下方按鈕以授權</span>}
            {permission === 'unsupported' && (
              <span className="text-amber-800">
                {iosNeedsInstall
                  ? '此瀏覽器尚未支援通知。iOS 請先將 tsMedia 加到主畫面'
                  : '此裝置或瀏覽器不支援通知功能'}
              </span>
            )}
          </div>
        </div>

        {/* Test notification button */}
        <button
          onClick={fireTestNotification}
          disabled={testStatus === 'sending'}
          className={cn(
            'w-full mb-5 py-3 rounded-2xl font-semibold text-sm transition-all flex items-center justify-center gap-2',
            testStatus === 'sent'
              ? 'bg-emerald-500 text-white'
              : testStatus === 'error'
              ? 'bg-red-500 text-white'
              : 'bg-slate-900 text-white active:scale-[0.98]',
          )}
        >
          {testStatus === 'idle'    && <><BellRing className="w-4 h-4" /> 發送測試通知</>}
          {testStatus === 'sending' && <>發送中…</>}
          {testStatus === 'sent'    && <><Check className="w-4 h-4" /> 已發送！請查看通知</>}
          {testStatus === 'error'   && <><AlertCircle className="w-4 h-4" /> {testError || '發送失敗'}</>}
        </button>

        {/* Items */}
        <div className="space-y-3">
          {items.map(({ key, icon: Icon, label, desc }) => (
            <div key={key} className="flex items-center gap-4 p-3.5 rounded-2xl bg-slate-50">
              <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0', settings[key] ? 'bg-slate-900' : 'bg-slate-200')}>
                <Icon className={cn('w-5 h-5', settings[key] ? 'text-white' : 'text-slate-400')} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-800">{label}</p>
                <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{desc}</p>
              </div>
              {/* Toggle */}
              <button
                onClick={() => toggle(key)}
                className={cn(
                  'w-12 h-6.5 rounded-full relative transition-colors flex-shrink-0',
                  settings[key] ? 'bg-slate-900' : 'bg-slate-200'
                )}
                style={{ width: 48, height: 26 }}
              >
                <motion.div
                  animate={{ x: settings[key] ? 22 : 2 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                  className="absolute top-[3px] w-5 h-5 rounded-full bg-white shadow-sm"
                />
              </button>
            </div>
          ))}
        </div>

        {/* Note */}
        <p className="text-[11px] text-slate-400 text-center mt-5 leading-relaxed">
          通知功能需在裝置設定中允許「tsMedia」發送通知
        </p>
      </motion.div>
    </motion.div>,
    document.body,
  )
}

// ─── Discover Tab ─────────────────────────────────────────────────────────────

function DiscoverTab({
  userId,
  currentUserGender,
  preferredRegion,
  contentScrollRef,
}: {
  userId?: string
  currentUserGender: 'male' | 'female'
  preferredRegion: import('@/lib/types').Region | null
  contentScrollRef?: React.RefObject<HTMLDivElement | null>
}) {
  // Men see female profiles, women see male profiles
  // Additional filter: if user set a preferred region, the candidate's work OR home region must match
  const visibleProfiles = PROFILES.filter((p) => {
    if (p.gender === currentUserGender) return false
    if (!preferredRegion) return true
    return p.workRegion === preferredRegion || p.homeRegion === preferredRegion
  })

  const [index, setIndex] = useState(0)
  const [direction, setDirection] = useState<'next' | 'prev'>('next')
  const [done, setDone] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [showNotifModal, setShowNotifModal] = useState(false)
  const [showNotifPrompt, setShowNotifPrompt] = useState(false)
  const cardScrollRef = useRef<HTMLDivElement | null>(null)

  // On first visit to Discover each session, prompt user to enable notifications
  // until they actually grant permission.
  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return
    if (Notification.permission === 'granted') return
    const dismissed = sessionStorage.getItem('notif_prompt_dismissed') === '1'
    if (dismissed) return
    // Small delay so the card animation settles first
    const t = setTimeout(() => setShowNotifPrompt(true), 600)
    return () => clearTimeout(t)
  }, [])

  // Reset hint + card scroll position whenever we switch to a new card
  useEffect(() => {
    setScrolled(false)
    // Reset outer main scroll too, in case user scrolled outer by mistake
    if (contentScrollRef?.current) contentScrollRef.current.scrollTop = 0
    // Scroll the card back to the photo
    if (cardScrollRef.current) cardScrollRef.current.scrollTop = 0
  }, [index])

  const profile = visibleProfiles[index]

  const goNext = () => {
    if (index >= visibleProfiles.length - 1) { setDone(true); return }
    setDirection('next')
    setIndex((i) => i + 1)
  }

  const goPrev = () => {
    if (index <= 0) return
    setDirection('prev')
    setIndex((i) => i - 1)
  }

  const handleInteraction = async (action: 'pass' | 'like' | 'super_like') => {
    if (userId && profile) {
      await recordProfileInteraction({
        targetProfileKey: `demo:${profile.id}`,
        targetUserId: profile.userId ?? null,
        action,
      })
    }
    goNext()
  }

  const handleLike = () => handleInteraction('like')
  const handleSuperLike = () => handleInteraction('super_like')
  const handlePass = () => handleInteraction('pass')

  if (done) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-8">
        <div className="w-20 h-20 rounded-full bg-slate-100 flex items-center justify-center mb-4">
          <Sparkles className="w-9 h-9 text-slate-300" />
        </div>
        <p className="text-slate-700 font-semibold text-lg">今日推薦已全部看完</p>
        <p className="text-slate-400 text-sm mt-1">明天再來探索更多工程師</p>
        <button
          onClick={() => { setIndex(0); setDone(false) }}
          className="mt-6 px-5 py-2.5 bg-slate-900 text-white text-sm font-semibold rounded-2xl"
        >
          重新瀏覽
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Counter */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2 flex-shrink-0">
        <div>
          <h1 className="text-[20px] font-bold text-slate-900 tracking-tight leading-none">探索</h1>
          <p className="text-xs text-slate-400 mt-0.5">{index + 1} / {visibleProfiles.length}</p>
        </div>
        <button
          onClick={() => setShowNotifModal(true)}
          className="w-9 h-9 rounded-full bg-white ring-1 ring-slate-100 shadow-sm flex items-center justify-center relative"
        >
          <Bell className="w-4 h-4 text-slate-500" />
          <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-red-400 rounded-full" />
        </button>
      </div>

      {/* Card — internal scroll */}
      <div className="relative flex-1 min-h-0 overflow-hidden px-4 pb-2">
        <AnimatePresence mode="wait">
          <motion.div
            key={profile.id}
            initial={{ opacity: 0, x: direction === 'next' ? 60 : -60 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: direction === 'next' ? -60 : 60 }}
            transition={{ duration: 0.26, ease: [0.4, 0, 0.2, 1] }}
            className="h-full"
          >
          <div
            ref={(el) => { cardScrollRef.current = el as HTMLDivElement | null }}
            className="h-full overflow-y-auto rounded-3xl bg-white shadow-md ring-1 ring-slate-100"
            style={{ WebkitOverflowScrolling: 'touch' }}
            onScroll={(e) => {
              if ((e.currentTarget as HTMLElement).scrollTop > 24) setScrolled(true)
            }}
          >
            {/* ── Photo header ── */}
            {(() => {
              const isDiamond = profile.showIncomeBorder && profile.incomeTier === 'diamond'
              return (
                <>
                  <IncomeBorder
                    tier={(profile.showIncomeBorder && profile.incomeTier) ? profile.incomeTier : null}
                    radius="1.4rem"
                    thickness={8}
                    showVerifyMark={false}
                    assetFrame={isDiamond}
                    className={isDiamond ? '' : 'm-3'}
                  >
                    <div
                      className={cn(
                        'relative w-full flex-shrink-0',
                        isDiamond ? 'overflow-visible rounded-[1.4rem]' : 'overflow-hidden rounded-[0.8rem]',
                      )}
                      style={{ paddingBottom: '150%' }}
                    >
                      {/* Diamond photos are clipped to the transparent opening inside the frame. */}
                      <div
                        className={cn('absolute overflow-hidden', isDiamond ? 'rounded-[1rem]' : 'inset-0 rounded-[0.8rem]')}
                        style={isDiamond ? {
                          left: '6%',
                          right: '6%',
                          top: '3.35%',
                          bottom: '3.5%',
                        } : undefined}
                      >
                        {/* Background: real photo or gradient */}
                        {profile.photoUrl ? (
                          <img
                            src={profile.photoUrl}
                            alt={profile.name}
                            className="absolute inset-0 w-full h-full object-cover scale-[1.04]"
                            style={{ filter: 'blur(6px)' }}
                          />
                        ) : (
                          <div
                            className="absolute inset-0"
                            style={{ background: `linear-gradient(160deg, ${profile.gradientFrom}, ${profile.gradientTo})` }}
                          />
                        )}

                        {/* Overlay */}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                      </div>

                      {/* Privacy badge */}
                      {profile.photoUrl && (
                        <div
                          className="absolute flex items-center gap-1.5 bg-black/30 backdrop-blur-md rounded-full px-3 py-1.5"
                          style={{ zIndex: 30, top: isDiamond ? '6%' : '1rem', left: isDiamond ? '8%' : '1rem' }}
                        >
                          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400" />
                          <span className="text-white/90 text-[10px] font-semibold">隱私保護中</span>
                        </div>
                      )}

                      {/* Compat badge */}
                      <div
                        className="absolute bg-black/30 backdrop-blur-md rounded-full px-3 py-1.5 flex items-center gap-1.5"
                        style={{ zIndex: 30, top: isDiamond ? '6%' : '1rem', right: isDiamond ? '8%' : '1rem' }}
                      >
                        <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                        <span className="text-sm font-bold text-white">{profile.compatScore}% 契合</span>
                      </div>

                      {/* Diamond2 frame wraps the full card; photo is inset to the frame opening above. */}
                      {isDiamond && (
                        <img
                          src="/assets/images/Diamond2-frame-clean.png"
                          aria-hidden
                          className="absolute inset-0 w-full h-full pointer-events-none select-none"
                          style={{
                            zIndex: 20,
                            objectFit: 'fill',
                          }}
                          draggable={false}
                        />
                      )}

                      {/* Diamond: name + company overlaid above frame at photo bottom */}
                      {isDiamond && (
                        <div className="absolute bottom-20 left-0 right-0 px-11 pt-10" style={{ zIndex: 30 }}>
                          <div className="flex items-baseline gap-2">
                            <span className="text-[1.75rem] font-semibold tracking-[-0.03em] text-white drop-shadow-sm">{profile.name}</span>
                            <span className="text-[1.1rem] font-medium text-white/70">{profile.age}</span>
                          </div>
                          <div className="mt-1">
                            <CompanyBadge company={profile.company} />
                          </div>
                        </div>
                      )}
                    </div>
                  </IncomeBorder>

                  {/* Non-diamond: name section below photo */}
                  {!isDiamond && (
                    <div className="px-5 pb-1 -mt-1">
                      <div className="flex items-end gap-3">
                        <div
                          className="w-16 h-16 rounded-[1.35rem] flex items-center justify-center text-white font-black text-3xl select-none overflow-hidden shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_10px_24px_rgba(15,23,42,0.18)]"
                          style={{ background: `linear-gradient(160deg, ${profile.gradientFrom}, ${profile.gradientTo})` }}
                        >
                          {profile.initials}
                        </div>
                        <div className="pb-1">
                          <div className="flex items-baseline gap-2">
                            <span className="text-[2rem] font-semibold tracking-[-0.03em] text-slate-900">{profile.name}</span>
                            <span className="text-[1.2rem] font-medium text-slate-500">{profile.age}</span>
                          </div>
                          <div className="mt-1">
                            <CompanyBadge company={profile.company} />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )
            })()}

            {/* ── Scroll hint — below photo, semi-transparent ── */}
            <AnimatePresence>
              {!scrolled && (
                <motion.div
                  initial={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.4 }}
                  className="flex flex-col items-center py-2 pointer-events-none bg-gradient-to-b from-white/60 to-white/90"
                >
                  <p className="text-[11px] font-semibold text-slate-400 tracking-wide mb-0.5">往下滑查看並配對</p>
                  <motion.div
                    animate={{ y: [0, 4, 0] }}
                    transition={{ repeat: Infinity, duration: 1.1, ease: 'easeInOut' }}
                  >
                    <ChevronDown className="w-4 h-4 text-slate-300" />
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── Info section ────────────────────────────────── */}
            <div className="p-4 pt-2 space-y-4">
              {/* Role / location / edu chips */}
              <div className="flex flex-wrap gap-2">
                {[
                  { icon: Briefcase, label: profile.role },
                  { icon: MapPin, label: profile.location },
                  { icon: GraduationCap, label: profile.education },
                ].map(({ icon: Icon, label }) => (
                  <div key={label} className="flex items-center gap-1.5 bg-slate-50 ring-1 ring-slate-100 rounded-full px-3 py-1.5">
                    <Icon className="w-3 h-3 text-slate-400" />
                    <span className="text-xs text-slate-600 font-medium">{label}</span>
                  </div>
                ))}
              </div>

              {/* Bio */}
              <div className="bg-slate-50 rounded-2xl px-4 py-3.5">
                <p className="text-sm text-slate-700 leading-relaxed">{profile.bio}</p>
              </div>

              {/* Interests */}
              <div className="flex flex-wrap gap-2">
                {profile.interests.map((tag) => (
                  <span key={tag} className="px-3 py-1 bg-white ring-1 ring-slate-200 rounded-full text-xs font-semibold text-slate-600">
                    {tag}
                  </span>
                ))}
              </div>

              {/* ── 機車題挑戰 ────────────────────────────────── */}
              <div>
                <p className="text-[11px] font-semibold text-neutral-500 tracking-[0.18em] uppercase mb-3">
                  機車題挑戰
                </p>

                <div className="space-y-2.5">
                  {profile.qa.map(({ question, answer }, i) => (
                    <div key={i} className="bg-neutral-50 rounded-xl p-4">
                      <p className="text-[13px] text-neutral-600 leading-snug">
                        <span className="font-semibold text-neutral-400 mr-1.5">Q.</span>
                        {question}
                      </p>
                      <p className="mt-2 text-[14px] font-semibold text-neutral-800 leading-snug">
                        <span className="font-semibold text-neutral-400 mr-1.5">A.</span>
                        {answer}
                        {isHardcoreAnswer(answer) && (
                          <Gem className="inline-block w-3 h-3 ml-1 -mt-0.5 text-slate-600" aria-label="hardcore" />
                        )}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Dept */}
              <div className="bg-white rounded-2xl px-4 py-3 ring-1 ring-slate-100 flex items-center gap-2">
                <Cpu className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                <span className="text-xs text-slate-500 font-medium">{profile.department}</span>
              </div>

              {/* compat bar */}
              <div className="bg-white rounded-2xl p-4 ring-1 ring-slate-100">
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="w-3.5 h-3.5 text-amber-400" />
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">AI 契合度</p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: `linear-gradient(90deg, ${profile.gradientFrom}, ${profile.gradientTo})` }}
                      initial={{ width: 0 }}
                      animate={{ width: `${profile.compatScore}%` }}
                      transition={{ duration: 0.8, ease: 'easeOut', delay: 0.2 }}
                    />
                  </div>
                  <span className="text-sm font-bold text-slate-600">{profile.compatScore}%</span>
                </div>
              </div>

              {/* ── Action buttons — 看完才出現，在卡片最底部 ── */}
              <div className="pt-2 pb-10">
                <div className="flex items-center gap-3 mb-5">
                  <div className="flex-1 h-px bg-slate-100" />
                  <span className="text-[10px] font-semibold text-slate-300 uppercase tracking-widest">你的決定</span>
                  <div className="flex-1 h-px bg-slate-100" />
                </div>

                <div className="flex items-center justify-center gap-4">
                  {index > 0 && (
                    <motion.button
                      whileTap={{ scale: 0.88 }}
                      onClick={goPrev}
                      className="w-12 h-12 rounded-full border-2 border-slate-200 bg-white flex items-center justify-center shadow-sm"
                    >
                      <ChevronLeft className="w-5 h-5 text-slate-400" />
                    </motion.button>
                  )}

                  <motion.button
                    whileTap={{ scale: 0.88 }}
                    onClick={handlePass}
                    className="w-16 h-16 rounded-full border-2 border-slate-200 bg-white flex items-center justify-center shadow-md"
                  >
                    <X className="w-7 h-7 text-slate-400" />
                  </motion.button>

                  <motion.button
                    whileTap={{ scale: 0.88 }}
                    onClick={handleLike}
                    className="w-16 h-16 rounded-full bg-slate-900 flex items-center justify-center shadow-lg shadow-slate-900/25"
                    aria-label="一般喜歡"
                  >
                    <Heart className="w-7 h-7 text-white" />
                  </motion.button>

                  <motion.button
                    whileTap={{ scale: 0.88 }}
                    onClick={handleSuperLike}
                    className="relative w-16 h-16 rounded-full bg-gradient-to-br from-rose-500 to-fuchsia-600 flex items-center justify-center shadow-lg shadow-rose-500/25"
                    aria-label="超級喜歡"
                  >
                    <Heart className="w-7 h-7 text-white fill-white" />
                    <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-black text-rose-500">
                      超級喜歡
                    </span>
                  </motion.button>

                  {index > 0 && <div className="w-12 h-12" />}
                </div>
                <p className="mt-8 text-center text-[11px] leading-relaxed text-slate-400">
                  一般愛心不會通知對方；超級喜歡會讓對方知道你對他有興趣。
                </p>
              </div>
            </div>
          </div>
          </motion.div>
        </AnimatePresence>

      </div>

      {/* Notification modal */}
      <AnimatePresence>
        {showNotifModal && <NotificationModal onClose={() => setShowNotifModal(false)} />}
      </AnimatePresence>

      {/* First-login notification prompt — shown until user actually grants permission */}
      <AnimatePresence>
        {showNotifPrompt && (
          <NotifEnablePrompt
            onDismiss={() => {
              sessionStorage.setItem('notif_prompt_dismissed', '1')
              setShowNotifPrompt(false)
            }}
            onOpenSettings={() => {
              setShowNotifPrompt(false)
              setShowNotifModal(true)
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Notification Enable Prompt (first-visit nudge on Discover) ──────────────

function NotifEnablePrompt({
  onDismiss,
  onOpenSettings,
}: {
  onDismiss: () => void
  onOpenSettings: () => void
}) {
  const [busy, setBusy] = useState(false)

  const enableNow = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      onOpenSettings()
      return
    }
    setBusy(true)
    try {
      const perm = Notification.permission === 'default'
        ? await Notification.requestPermission()
        : Notification.permission
      if (perm === 'granted') {
        // Enable the core toggles by default once user grants permission
        try {
          const defaults = { newMatch: true, messages: true, newProfile: false, weeklyDigest: false }
          const saved = localStorage.getItem('notif_settings')
          const merged = saved ? { ...JSON.parse(saved), newMatch: true, messages: true } : defaults
          localStorage.setItem('notif_settings', JSON.stringify(merged))
        } catch { /* noop */ }
        // Fire a welcome ping so the user immediately sees it works
        try {
          const options: NotificationOptions = {
            body: '通知已啟用，有人對你按超級喜歡、配對成功或傳訊息時會第一時間通知你',
            icon: '/icons/icon-192.png',
            badge: '/icons/icon-192.png',
            tag: 'tsmedia-welcome',
          }
          if ('serviceWorker' in navigator) {
            const reg = await navigator.serviceWorker.ready
            await reg.showNotification('通知已開啟', options)
          } else {
            new Notification('通知已開啟', options)
          }
        } catch { /* noop */ }
        onDismiss()
      } else {
        // Denied or still default — send them to the settings panel for guidance
        onOpenSettings()
      }
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-[210] flex items-center justify-center px-6"
      style={{ background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(6px)' }}
      onClick={onDismiss}
    >
      <motion.div
        initial={{ scale: 0.92, opacity: 0, y: 10 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 360, damping: 32 }}
        className="w-full max-w-sm bg-white rounded-3xl px-6 pt-7 pb-5 text-center shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-16 h-16 rounded-2xl bg-slate-900 mx-auto flex items-center justify-center mb-4">
          <BellRing className="w-8 h-8 text-white" />
        </div>
        <h3 className="text-[19px] font-bold text-slate-900 tracking-tight mb-2">開啟通知，不錯過任何配對</h3>
        <p className="text-[13px] text-slate-500 leading-relaxed mb-5">
          一般愛心不會通知對方；當有人對你按超級喜歡、配對成功或傳訊息時，我們會立即通知你。
        </p>
        <button
          onClick={enableNow}
          disabled={busy}
          className="w-full py-3.5 rounded-2xl bg-slate-900 text-white text-sm font-semibold active:scale-[0.98] transition-all disabled:opacity-60"
        >
          {busy ? '處理中…' : '立即開啟通知'}
        </button>
        <button
          onClick={onDismiss}
          className="w-full py-2.5 mt-1 text-[13px] text-slate-400"
        >
          稍後再說
        </button>
      </motion.div>
    </motion.div>,
    document.body,
  )
}

// ─── Matches Tab ─────────────────────────────────────────────────────────────

// ── Shared Person type used by the "view partner profile" modal ──────────────
interface PersonSummary {
  id: number
  name: string
  initials: string
  gradientFrom: string
  gradientTo: string
  company: string
  role: string
  subtitle?: string       // optional extra line (e.g. "理律 · 律師")
}

function MatchesTab({ onOpenPerson, onStartChat }: {
  onOpenPerson: (p: PersonSummary) => void
  onStartChat: (id: number) => void
}) {
  return (
    <div className="flex flex-col h-full">
      <div className="px-5 pt-4 pb-2">
        <h1 className="text-[22px] font-bold text-slate-900 tracking-tight">配對</h1>
        <p className="text-xs text-slate-400 mt-0.5">你的 {MATCHES.length} 個配對</p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pt-2 space-y-3 pb-4" style={{ WebkitOverflowScrolling: 'touch' }}>
        {MATCHES.map((match) => (
          <motion.div
            key={match.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-2xl p-4 shadow-sm ring-1 ring-slate-100"
          >
            <div className="flex items-center gap-4">
              {/* Avatar — tap opens partner profile */}
              <button
                type="button"
                onClick={() => onOpenPerson({
                  id: match.id, name: match.name, initials: match.initials,
                  gradientFrom: match.from, gradientTo: match.to,
                  company: match.company, role: match.role,
                })}
                className="w-14 h-14 rounded-full flex items-center justify-center text-white font-bold text-lg flex-shrink-0 active:scale-95 transition-transform"
                style={{ background: `linear-gradient(135deg, ${match.from}, ${match.to})` }}
                aria-label={`查看 ${match.name} 的個人檔案`}
              >
                {match.initials}
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-semibold text-slate-900 text-sm">{match.name}</span>
                  <span className={cn(
                    'text-[10px] font-semibold px-1.5 py-0.5 rounded-full',
                    match.company === 'TSMC' ? 'bg-blue-50 text-blue-600' : 'bg-indigo-50 text-indigo-600',
                  )}>
                    {match.company}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 truncate">{match.role}</p>
              </div>
              <span className="text-[10px] text-slate-400 flex-shrink-0">{match.time}</span>
            </div>

            {/* Actions */}
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => onOpenPerson({
                  id: match.id, name: match.name, initials: match.initials,
                  gradientFrom: match.from, gradientTo: match.to,
                  company: match.company, role: match.role,
                })}
                className="flex-1 py-2 rounded-xl text-xs font-bold bg-slate-100 text-slate-700 active:bg-slate-200 transition-colors"
              >
                查看檔案
              </button>
              <button
                type="button"
                onClick={() => onStartChat(match.id)}
                className="flex-[1.4] py-2 rounded-xl text-xs font-bold bg-slate-900 text-white flex items-center justify-center gap-1.5 active:bg-slate-800 transition-colors relative"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                開始聊天
                {match.unread > 0 && (
                  <span className="ml-1 min-w-[16px] h-[16px] px-1 bg-white text-slate-900 rounded-full text-[9px] font-black flex items-center justify-center">
                    {match.unread}
                  </span>
                )}
              </button>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

// ─── Person Detail Modal — viewable partner profile ──────────────────────────

function PersonDetailView({
  person,
  onClose,
  onStartChat,
}: {
  person: PersonSummary
  onClose: () => void
  onStartChat?: (id: number) => void
}) {
  // Look up the full profile so this view is visually identical to the
  // Discover card — same photo header, same chips, same bio, same Q&A.
  const profile = findFullProfile(person.id)

  return createPortal(
    <motion.div
      className="fixed inset-0 z-[100] bg-[#fafafa] flex flex-col"
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', stiffness: 320, damping: 36 }}
    >
      {/* Top bar */}
      <div className="flex-shrink-0 px-4 pt-safe pb-2 flex items-center justify-between">
        <button
          onClick={onClose}
          className="w-9 h-9 rounded-full bg-white ring-1 ring-slate-100 shadow-sm flex items-center justify-center"
        >
          <ChevronLeft className="w-5 h-5 text-slate-600" />
        </button>
        <span className="text-sm font-bold text-slate-900">個人檔案</span>
        <div className="w-9 h-9" />
      </div>

      {/* Scrollable content — layout mirrors the Discover card exactly */}
      <div
        className="flex-1 overflow-y-auto px-4 pb-24"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {profile ? (
          <div className="rounded-3xl bg-white shadow-md ring-1 ring-slate-100 overflow-hidden">
            {/* ── Photo header — vertical 2:3 portrait with thin platinum frame ── */}
            <IncomeBorder
              tier={(profile.showIncomeBorder && profile.incomeTier) ? profile.incomeTier : null}
              radius="1.4rem"
              thickness={8}
              showVerifyMark={false}
              assetFrame={profile.showIncomeBorder && profile.incomeTier === 'diamond'}
              className="m-3"
            >
              <div
                className="relative w-full flex-shrink-0 overflow-hidden rounded-[0.8rem]"
                style={{ paddingBottom: '150%' }}
              >
                {profile.photoUrl ? (
                  <img
                    src={profile.photoUrl}
                    alt={profile.name}
                    className="absolute inset-0 w-full h-full object-cover scale-[1.04]"
                    style={{ filter: 'blur(6px)' }}
                  />
                ) : (
                  <div
                    className="absolute inset-0"
                    style={{ background: `linear-gradient(160deg, ${profile.gradientFrom}, ${profile.gradientTo})` }}
                  />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />

                {profile.photoUrl && (
                  <div className="absolute top-4 left-4 flex items-center gap-1.5 bg-black/30 backdrop-blur-md rounded-full px-3 py-1.5">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    <span className="text-white/90 text-[10px] font-semibold">隱私保護中</span>
                  </div>
                )}

                <div className="absolute top-4 right-4 bg-black/30 backdrop-blur-md rounded-full px-3 py-1.5 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                  <span className="text-sm font-bold text-white">{profile.compatScore}% 契合</span>
                </div>
              </div>
            </IncomeBorder>

            <div className="px-5 pb-1 -mt-1">
              <div className="flex items-end gap-3">
                <div
                  className="w-16 h-16 rounded-[1.35rem] flex items-center justify-center text-white font-black text-3xl select-none overflow-hidden shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_10px_24px_rgba(15,23,42,0.18)]"
                  style={{ background: `linear-gradient(160deg, ${profile.gradientFrom}, ${profile.gradientTo})` }}
                >
                  {profile.initials}
                </div>
                <div className="pb-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[2rem] font-semibold tracking-[-0.03em] text-slate-900">{profile.name}</span>
                    <span className="text-[1.2rem] font-medium text-slate-500">{profile.age}</span>
                  </div>
                  <div className="mt-1">
                    <CompanyBadge company={profile.company} />
                  </div>
                </div>
              </div>
            </div>

            {/* ── Info section (identical to Discover) ─────────────── */}
            <div className="p-4 pt-2 space-y-4">
              <div className="flex flex-wrap gap-2">
                {[
                  { icon: Briefcase, label: profile.role },
                  { icon: MapPin, label: profile.location },
                  { icon: GraduationCap, label: profile.education },
                ].map(({ icon: Icon, label }) => (
                  <div key={label} className="flex items-center gap-1.5 bg-slate-50 ring-1 ring-slate-100 rounded-full px-3 py-1.5">
                    <Icon className="w-3 h-3 text-slate-400" />
                    <span className="text-xs text-slate-600 font-medium">{label}</span>
                  </div>
                ))}
              </div>

              <div className="bg-slate-50 rounded-2xl px-4 py-3.5">
                <p className="text-sm text-slate-700 leading-relaxed">{profile.bio}</p>
              </div>

              <div className="flex flex-wrap gap-2">
                {profile.interests.map((tag) => (
                  <span key={tag} className="px-3 py-1 bg-white ring-1 ring-slate-200 rounded-full text-xs font-semibold text-slate-600">
                    {tag}
                  </span>
                ))}
              </div>

              <div>
                <p className="text-[11px] font-semibold text-neutral-500 tracking-[0.18em] uppercase mb-3">
                  機車題挑戰
                </p>

                <div className="space-y-2.5">
                  {profile.qa.map(({ question, answer }, i) => (
                    <div key={i} className="bg-neutral-50 rounded-xl p-4">
                      <p className="text-[13px] text-neutral-600 leading-snug">
                        <span className="font-semibold text-neutral-400 mr-1.5">Q.</span>
                        {question}
                      </p>
                      <p className="mt-2 text-[14px] font-semibold text-neutral-800 leading-snug">
                        <span className="font-semibold text-neutral-400 mr-1.5">A.</span>
                        {answer}
                        {isHardcoreAnswer(answer) && (
                          <Gem className="inline-block w-3 h-3 ml-1 -mt-0.5 text-slate-600" aria-label="hardcore" />
                        )}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white rounded-2xl px-4 py-3 ring-1 ring-slate-100 flex items-center gap-2">
                <Cpu className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                <span className="text-xs text-slate-500 font-medium">{profile.department}</span>
              </div>

              <div className="bg-white rounded-2xl p-4 ring-1 ring-slate-100">
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="w-3.5 h-3.5 text-amber-400" />
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">AI 契合度</p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: `linear-gradient(90deg, ${profile.gradientFrom}, ${profile.gradientTo})` }}
                      initial={{ width: 0 }}
                      animate={{ width: `${profile.compatScore}%` }}
                      transition={{ duration: 0.8, ease: 'easeOut', delay: 0.2 }}
                    />
                  </div>
                  <span className="text-sm font-bold text-slate-600">{profile.compatScore}%</span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          // Fallback when full profile not available — minimal summary hero
          <div className="mt-2 rounded-3xl overflow-hidden relative" style={{ minHeight: 260 }}>
            <div
              className="absolute inset-0"
              style={{ background: `linear-gradient(160deg, ${person.gradientFrom}, ${person.gradientTo})` }}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
            <div className="relative z-10 p-6 h-[260px] flex items-end">
              <div>
                <div className="w-20 h-20 rounded-2xl bg-white/15 backdrop-blur flex items-center justify-center text-white font-black text-4xl ring-2 ring-white/25 mb-3">
                  {person.initials}
                </div>
                <h2 className="text-2xl font-extrabold text-white tracking-tight">{person.name}</h2>
                <div className="mt-1.5">
                  <CompanyBadge company={person.company} />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom CTA */}
      {onStartChat && (
        <div
          className="flex-shrink-0 px-5 pt-3 bg-[#fafafa] border-t border-slate-100"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}
        >
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => onStartChat(person.id)}
            className="w-full py-3.5 bg-slate-900 text-white rounded-2xl font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-slate-900/20"
          >
            <MessageSquare className="w-4 h-4" />
            開始聊天
          </motion.button>
        </div>
      )}
    </motion.div>,
    document.body,
  )
}

// ─── Messages Tab ─────────────────────────────────────────────────────────────

// ─── LINE-style message data ─────────────────────────────────────────────────

interface ChatMessage {
  id: number
  text: string
  from: 'me' | 'them'
  time: string        // HH:mm
  date: string        // 今天 / 昨天 / 2024/5/20
  read?: boolean      // only meaningful for 'me'
}

interface Conversation {
  id: number
  name: string
  subtitle: string
  initials: string
  from: string
  to: string
  messages: ChatMessage[]
}

const CONVERSATIONS: Conversation[] = [
  {
    id: 101,
    name: '王雅婷',
    subtitle: '理律法律事務所 · 律師',
    initials: '王',
    from: '#7c3aed',
    to: '#6d28d9',
    messages: [
      { id: 1, text: '你也喜歡手沖嗎？我最近在練習 V60 ☕',             from: 'them', time: '14:32', date: '今天' },
      { id: 2, text: '早安，剛剛看到你分享的那篇文章',                  from: 'them', time: '14:32', date: '今天' },
      { id: 3, text: '對！最近迷上了衣索比亞豆，果香真的很迷人',        from: 'me',   time: '14:35', date: '今天', read: true },
      { id: 4, text: '哇，品味很好耶！你在新竹嗎？有一間小店推薦你',    from: 'them', time: '14:36', date: '今天' },
      { id: 5, text: '在台北，週末才會回新竹',                          from: 'me',   time: '14:40', date: '今天', read: false },
    ],
  },
  {
    id: 102,
    name: '劉承恩',
    subtitle: 'TSMC · 製程研發工程師',
    initials: '劉',
    from: '#0f766e',
    to: '#0d9488',
    messages: [
      { id: 1, text: '週末要一起去陽明山嗎？', from: 'them', time: '11:20', date: '今天' },
      { id: 2, text: '氣象預報看起來不錯',     from: 'them', time: '11:21', date: '今天' },
    ],
  },
  {
    id: 103,
    name: '蔡佩如',
    subtitle: 'MediaTek · 數位設計工程師',
    initials: '蔡',
    from: '#b45309',
    to: '#d97706',
    messages: [
      { id: 1, text: '那部紀錄片我也很想看！', from: 'them', time: '昨天', date: '昨天' },
      { id: 2, text: '下週末有空嗎？',          from: 'me',   time: '昨天', date: '昨天', read: true },
    ],
  },
]

// ─── Chat List View ──────────────────────────────────────────────────────────

function ChatListView({
  onOpen,
  onOpenPerson,
}: {
  onOpen: (conv: Conversation) => void
  onOpenPerson?: (p: PersonSummary) => void
}) {
  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="flex-shrink-0 px-5 pt-4 pb-3 flex items-center justify-between">
        <h1 className="text-[22px] font-extrabold text-slate-900 tracking-tight">聊天</h1>
        <button className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center">
          <Search className="w-[18px] h-[18px] text-slate-600" />
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
        {CONVERSATIONS.map((conv) => {
          const last = conv.messages[conv.messages.length - 1]
          const unread = conv.messages.filter((m) => m.from === 'them' && !conv.messages.some((mm) => mm.from === 'me' && mm.id > m.id)).length
          return (
            <div
              key={conv.id}
              className="w-full flex items-center gap-3 px-4 py-3 border-b border-slate-50"
            >
              {/* Avatar — separate tap target → opens partner profile */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onOpenPerson?.({
                    id: conv.id, name: conv.name, initials: conv.initials,
                    gradientFrom: conv.from, gradientTo: conv.to,
                    company: conv.subtitle.split(' · ')[0] ?? '',
                    role:    conv.subtitle.split(' · ')[1] ?? '',
                    subtitle: conv.subtitle,
                  })
                }}
                className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-base flex-shrink-0 active:scale-95 transition-transform"
                style={{ background: `linear-gradient(135deg, ${conv.from}, ${conv.to})` }}
                aria-label={`查看 ${conv.name} 的個人檔案`}
              >
                {conv.initials}
              </button>
              {/* Rest of row — tap opens chat */}
              <button
                type="button"
                onClick={() => onOpen(conv)}
                className="flex-1 min-w-0 text-left active:bg-slate-50 transition-colors rounded-lg -mx-1 px-1 py-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[15px] font-semibold text-slate-900 truncate">{conv.name}</p>
                  <span className="text-[11px] text-slate-400 flex-shrink-0">{last?.time ?? ''}</span>
                </div>
                <div className="flex items-center justify-between gap-2 mt-0.5">
                  <p className="text-[13px] text-slate-500 truncate">
                    {last?.from === 'me' ? '你：' : ''}{last?.text ?? ''}
                  </p>
                  {unread > 0 && (
                    <span className="flex-shrink-0 min-w-[18px] h-[18px] px-1.5 rounded-full bg-emerald-500 text-white text-[10px] font-bold flex items-center justify-center">
                      {unread}
                    </span>
                  )}
                </div>
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Chat Room View (LINE-style) ─────────────────────────────────────────────

function ChatRoomView({
  conversation,
  onBack,
  onChatInputFocus,
  onChatInputBlur,
}: {
  conversation: Conversation
  onBack: () => void
  onChatInputFocus?: () => void
  onChatInputBlur?: () => void
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(conversation.messages)
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef  = useRef<HTMLInputElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages])

  // When the keyboard opens/closes the viewport resizes — make sure the
  // latest message stays in view rather than getting hidden behind the composer.
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const onResize = () => {
      bottomRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' })
    }
    vv.addEventListener('resize', onResize)
    return () => vv.removeEventListener('resize', onResize)
  }, [])

  const send = () => {
    if (!input.trim()) return
    const now = new Date()
    const hh = String(now.getHours()).padStart(2, '0')
    const mm = String(now.getMinutes()).padStart(2, '0')
    setMessages((prev) => [
      ...prev,
      { id: Date.now(), text: input.trim(), from: 'me', time: `${hh}:${mm}`, date: '今天', read: false },
    ])
    setInput('')
  }

  // Group consecutive messages from the same sender to suppress repeated avatars
  type Group = { from: 'me' | 'them'; date: string; items: ChatMessage[] }
  const groups: Group[] = []
  for (const m of messages) {
    const last = groups[groups.length - 1]
    if (last && last.from === m.from && last.date === m.date) {
      last.items.push(m)
    } else {
      groups.push({ from: m.from, date: m.date, items: [m] })
    }
  }

  // Date separators — detect when date changes across groups
  const renderBlocks: Array<{ type: 'date'; date: string } | { type: 'group'; group: Group }> = []
  let lastDate = ''
  for (const g of groups) {
    if (g.date !== lastDate) {
      renderBlocks.push({ type: 'date', date: g.date })
      lastDate = g.date
    }
    renderBlocks.push({ type: 'group', group: g })
  }

  return (
    <div className="relative flex flex-col h-full bg-white">
      {/* Floating back button — no header bar, just this */}
      <button
        onClick={onBack}
        aria-label="返回"
        className="absolute top-2 left-2 z-20 w-9 h-9 rounded-full bg-white/80 backdrop-blur-md shadow-sm flex items-center justify-center active:bg-white"
      >
        <ChevronLeft className="w-5 h-5 text-slate-700" />
      </button>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 pt-14 pb-3 space-y-1" style={{ WebkitOverflowScrolling: 'touch' }}>
        {renderBlocks.map((block, bi) => {
          if (block.type === 'date') {
            return (
              <div key={`date-${bi}`} className="flex justify-center py-2">
                <span className="text-[11px] text-slate-500 bg-slate-100 px-3 py-1 rounded-full">
                  {block.date}
                </span>
              </div>
            )
          }

          const g = block.group
          const isMe = g.from === 'me'
          return (
            <div key={`grp-${bi}`} className={cn('flex items-end gap-2', isMe ? 'justify-end' : 'justify-start')}>
              {/* Avatar column — only on their side, only on the LAST bubble of the group (bottom-aligned) */}
              {!isMe && (
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-[12px] flex-shrink-0"
                  style={{ background: `linear-gradient(135deg, ${conversation.from}, ${conversation.to})` }}
                >
                  {conversation.initials}
                </div>
              )}

              <div className={cn('flex flex-col gap-1 max-w-[72%]', isMe ? 'items-end' : 'items-start')}>
                {!isMe && (
                  <p className="text-[11px] text-slate-500 px-1">{conversation.name}</p>
                )}
                {g.items.map((msg, mi) => {
                  const isLast = mi === g.items.length - 1
                  return (
                    <div key={msg.id} className={cn('flex items-end gap-1.5', isMe ? 'flex-row' : 'flex-row-reverse')}>
                      {/* Timestamp — shown only under the LAST bubble of a burst */}
                      {isLast && (
                        <div className={cn('flex flex-col text-[10px] text-slate-400', isMe ? 'items-end' : 'items-start')}>
                          {isMe && msg.read && <span className="leading-none">已讀</span>}
                          <span className="leading-none mt-0.5">{msg.time}</span>
                        </div>
                      )}
                      <motion.div
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={cn(
                          'px-3.5 py-2 text-[14px] leading-[1.45] whitespace-pre-wrap break-words',
                          isMe
                            ? 'bg-[#8fe37f] text-slate-900 rounded-2xl rounded-br-md'
                            : 'bg-slate-100 text-slate-900 rounded-2xl rounded-bl-md',
                        )}
                      >
                        {msg.text}
                      </motion.div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <div className="flex-shrink-0 px-2 py-2 bg-white border-t border-slate-200 flex items-center gap-1.5">
        <button className="w-9 h-9 rounded-full flex items-center justify-center text-slate-500 active:bg-slate-100 flex-shrink-0">
          <Plus className="w-5 h-5" />
        </button>
        <div className="flex-1 flex items-center bg-slate-100 rounded-full pl-4 pr-1 min-h-[38px]">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); send() } }}
            onFocus={() => onChatInputFocus?.()}
            onBlur={() => onChatInputBlur?.()}
            placeholder="輸入訊息"
            style={{ fontSize: '16px' }}
            className="flex-1 bg-transparent outline-none text-slate-900 placeholder:text-slate-400 py-1"
          />
          <button className="w-7 h-7 rounded-full flex items-center justify-center text-slate-500 flex-shrink-0">
            <Smile className="w-[18px] h-[18px]" />
          </button>
        </div>
        {input.trim() ? (
          <motion.button
            onMouseDown={(e) => e.preventDefault()}
            onClick={send}
            whileTap={{ scale: 0.9 }}
            className="w-9 h-9 rounded-full bg-emerald-500 flex items-center justify-center flex-shrink-0"
          >
            <Send className="w-4 h-4 text-white" />
          </motion.button>
        ) : (
          <button className="w-9 h-9 rounded-full flex items-center justify-center text-slate-500 active:bg-slate-100 flex-shrink-0">
            <Camera className="w-5 h-5" />
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Messages Tab — chat list ⇄ chat room ────────────────────────────────────

function MessagesTab({
  onChatInputFocus,
  onChatInputBlur,
  requestedConversationId,
  onConversationOpened,
  onOpenPerson,
}: {
  onChatInputFocus?: () => void
  onChatInputBlur?: () => void
  /** When the parent asks us to open a specific conversation (e.g. from MatchesTab "開始聊天"). */
  requestedConversationId?: number | null
  onConversationOpened?: () => void
  onOpenPerson?: (p: PersonSummary) => void
}) {
  const [active, setActive] = useState<Conversation | null>(null)

  // Ensure keyboard-state flag clears when we leave the chat room
  useEffect(() => {
    if (!active) onChatInputBlur?.()
  }, [active, onChatInputBlur])

  // React to "open this conversation" requests from the parent
  useEffect(() => {
    if (requestedConversationId == null) return
    const conv = CONVERSATIONS.find((c) => c.id === requestedConversationId)
    if (conv) setActive(conv)
    onConversationOpened?.()
  }, [requestedConversationId, onConversationOpened])

  if (active) {
    return (
      <ChatRoomView
        conversation={active}
        onBack={() => setActive(null)}
        onChatInputFocus={onChatInputFocus}
        onChatInputBlur={onChatInputBlur}
      />
    )
  }

  return <ChatListView onOpen={setActive} onOpenPerson={onOpenPerson} />
}

// ─── Profile Tab ──────────────────────────────────────────────────────────────

// ─── Edit Profile (Full Screen) ───────────────────────────────────────────────

interface LocalPhoto {
  id: string
  previewUrl: string
  storagePath?: string  // already uploaded
  file?: File           // new, not yet uploaded
}

const REGION_OPTIONS: Region[] = ['north', 'central', 'south', 'east']

function EditRegionGrid({
  value,
  onChange,
}: {
  value: Region | ''
  onChange: (r: Region) => void
}) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {REGION_OPTIONS.map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => onChange(r)}
          className={cn(
            'py-2.5 rounded-xl text-sm font-semibold border-2 transition-all',
            value === r
              ? 'border-slate-900 bg-slate-900 text-white'
              : 'border-slate-200 text-slate-500 bg-white',
          )}
        >
          {REGION_LABELS[r]}
        </button>
      ))}
    </div>
  )
}

function EditProfileScreen({
  profile,
  userId,
  onClose,
  onSaved,
}: {
  profile: ProfileRow
  userId: string
  onClose: () => void
  onSaved: (updated: ProfileRow) => void
}) {
  const [name, setName]     = useState(profile.name ?? '')
  const [bio, setBio]       = useState(profile.bio ?? '')
  const [workRegion,      setWorkRegion]      = useState<import('@/lib/types').Region | ''>(profile.work_region ?? '')
  const [homeRegion,      setHomeRegion]      = useState<import('@/lib/types').Region | ''>(profile.home_region ?? '')
  const [preferredRegion, setPreferredRegion] = useState<import('@/lib/types').Region | ''>(profile.preferred_region ?? '')
  const [showIncomeBorder, setShowIncomeBorder] = useState<boolean>(profile.show_income_border ?? false)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  // Photos
  const [photos, setPhotos] = useState<LocalPhoto[]>(() =>
    (profile.photo_urls ?? []).map((p, i) => ({ id: `existing-${i}`, previewUrl: p, storagePath: p })),
  )
  const photoInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false

    const loadExistingPhotoUrls = async () => {
      const storedPaths = profile.photo_urls ?? []
      if (storedPaths.length === 0) {
        setPhotos([])
        return
      }

      const signedUrls = await resolvePhotoUrls(storedPaths)
      if (cancelled) return

      setPhotos((prev) => {
        const newPhotos = prev.filter((photo) => photo.file)
        const existingPhotos = storedPaths.map((path, i) => ({
          id: `existing-${i}`,
          previewUrl: signedUrls[i] ?? path,
          storagePath: path,
        }))
        return [...existingPhotos, ...newPhotos].slice(0, 5)
      })
    }

    loadExistingPhotoUrls()
    return () => { cancelled = true }
  }, [profile.photo_urls])

  // Questionnaire
  const [qa, setQa] = useState<QuestionnaireEntry[]>(() =>
    profile.questionnaire ?? [],
  )

  // Income verification status (for display — auto re-loaded after upload completes)
  const [incomeStatus, setIncomeStatus] = useState<{
    status: 'pending' | 'approved' | 'rejected'
    claimed: IncomeTier | null
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    getIncomeVerification(userId).then((row) => {
      if (cancelled) return
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = row as any
      if (r) setIncomeStatus({ status: r.status, claimed: r.claimed_income_tier })
      else   setIncomeStatus(null)
    })
    return () => { cancelled = true }
  }, [userId])

  // Income upload form state
  const [incomeUploadTier, setIncomeUploadTier] = useState<IncomeTier | null>(null)
  const [incomeUploadFile, setIncomeUploadFile] = useState<File | null>(null)
  const [uploadingIncome, setUploadingIncome] = useState(false)
  const [incomeSubmitMsg, setIncomeSubmitMsg] = useState('')
  const [incomeReviewCountdown, setIncomeReviewCountdown] = useState(0)
  const incomeDocRef = useRef<HTMLInputElement>(null)
  const canSubmitIncomeVerification = profile.verification_status === 'approved'

  useEffect(() => {
    if (incomeReviewCountdown <= 0) return
    const timer = window.setTimeout(() => setIncomeReviewCountdown((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [incomeReviewCountdown])

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })

  const fileToEnhancedBase64 = (file: File): Promise<string> =>
    new Promise((resolve) => {
      if (!file.type.startsWith('image/')) {
        fileToBase64(file).then(resolve)
        return
      }

      const img = new Image()
      const objectUrl = URL.createObjectURL(file)
      img.onload = () => {
        URL.revokeObjectURL(objectUrl)
        const maxSide = 2600
        const scale = Math.min(3, Math.max(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight)))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.naturalWidth * scale)
        canvas.height = Math.round(img.naturalHeight * scale)
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          fileToBase64(file).then(resolve)
          return
        }
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        ctx.filter = 'contrast(1.22) brightness(1.06) saturate(0.85)'
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.95))
      }
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl)
        fileToBase64(file).then(resolve)
      }
      img.src = objectUrl
    })

  const reviewIncomeWithAI = async (file: File, tier: IncomeTier) => {
    if (!file.type.startsWith('image/')) {
      return {
        passed: false,
        company: null,
        confidence: null,
        reason: 'PDF 文件無法即時 AI 審核，已轉人工審核。人工審核時間可能大於 12 小時。',
      } as const
    }

    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 5 * 60 * 1000)
    try {
      const imageBase64 = await fileToEnhancedBase64(file)
      const response = await fetch('/api/verify-id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64,
          verificationKind: 'income',
          claimedIncomeTier: tier,
          claimedName: profile.name ?? undefined,
          claimedCompany: profile.company ?? undefined,
          docType: 'other',
        }),
        signal: controller.signal,
      })
      const data = await response.json() as {
        ok: boolean
        confidence?: string
        suggestedIncomeTier?: string | null
        message: string
        reason?: string
      }
      const confidence: AiConfidence | null =
        data.confidence === 'high' || data.confidence === 'medium' || data.confidence === 'low'
          ? data.confidence
          : null
      return {
        passed: data.ok,
        company: null,
        confidence,
        suggestedIncomeTier: toIncomeTier(data.suggestedIncomeTier),
        reason: data.reason ?? data.message,
      }
    } finally {
      window.clearTimeout(timeout)
    }
  }

  const submitIncome = async () => {
    if (!incomeUploadTier || !incomeUploadFile) return
    setIncomeSubmitMsg('')
    if (!canSubmitIncomeVerification) {
      setIncomeSubmitMsg('請先完成職業資料認證，通過後才能申請薪資收入審核。')
      return
    }
    setUploadingIncome(true)
    const count = await getTodayVerificationSubmissionCount(userId)
    if (count >= 20) {
      setIncomeSubmitMsg('今天已達送審上限 20 次，請明天再試。')
      setUploadingIncome(false)
      return
    }

    const optimisticIncomeTier = incomeUploadTier
    setIncomeStatus({ status: 'pending', claimed: optimisticIncomeTier })
    setIncomeReviewCountdown(AI_REVIEW_SECONDS)
    setIncomeSubmitMsg(`AI 審核倒數 ${AI_REVIEW_SECONDS} 秒。`)

    let aiResult: Awaited<ReturnType<typeof reviewIncomeWithAI>>
    let reviewMode: 'ai_auto' | 'manual' = 'manual'
    let manualReason = ''
    try {
      aiResult = await reviewIncomeWithAI(incomeUploadFile, incomeUploadTier)
      if (aiResult.passed) {
        reviewMode = 'ai_auto'
        setIncomeSubmitMsg(`AI 審核中，AI 審核時間為 ${AI_REVIEW_SECONDS} 秒。`)
      } else {
        manualReason = aiResult.reason || 'AI 未通過，已轉人工審核。人工審核時間可能大於 12 小時。'
        setIncomeSubmitMsg(manualReason)
      }
    } catch {
      aiResult = {
        passed: false,
        company: null,
        confidence: null,
        suggestedIncomeTier: null,
        reason: 'AI 暫時無法完成審核，已轉人工審核。人工審核時間可能大於 12 小時。',
      }
      manualReason = aiResult.reason
      setIncomeSubmitMsg(manualReason)
    }

    const res = await uploadProofDoc(userId, incomeUploadFile)
    if (res.ok) {
      await submitIncomeVerification(userId, incomeUploadTier, 'payslip', res.path, aiResult, reviewMode, manualReason)
      setIncomeUploadFile(null)
      setIncomeUploadTier(null)
    } else {
      setIncomeStatus(null)
      setIncomeReviewCountdown(0)
      setIncomeSubmitMsg(`文件上傳失敗：${res.error ?? '請稍後再試'}`)
    }
    setUploadingIncome(false)
  }

  const addPhotos = (files: FileList | null) => {
    if (!files) return
    const newItems: LocalPhoto[] = Array.from(files)
      .slice(0, 5 - photos.length)
      .map((f) => ({
        id: `new-${Date.now()}-${f.name}`,
        previewUrl: URL.createObjectURL(f),
        file: f,
      }))
    setPhotos((prev) => [...prev, ...newItems].slice(0, 5))
  }

  const removePhoto = (id: string) => {
    setPhotos((prev) => {
      const removed = prev.find((p) => p.id === id)
      if (removed?.file) URL.revokeObjectURL(removed.previewUrl)
      return prev.filter((p) => p.id !== id)
    })
  }

  const updateAnswer = (index: number, answer: string) => {
    setQa((prev) => prev.map((q, i) => i === index ? { ...q, answer } : q))
  }

  const save = async () => {
    if (!name.trim()) return
    setSaving(true)
    setSaveMsg('')

    // Upload new photos
    const uploadedPaths: string[] = []
    for (const photo of photos) {
      if (photo.storagePath) {
        uploadedPaths.push(photo.storagePath)
      } else if (photo.file) {
        const res = await uploadPhoto(userId, photo.file)
        if (res.ok) uploadedPaths.push(res.path)
      }
    }

    const result = await upsertProfile({
      userId,
      name: name.trim(),
      bio: bio.trim(),
      questionnaire: qa.length > 0 ? qa : undefined,
      photoUrls: uploadedPaths.length > 0 ? uploadedPaths : undefined,
      workRegion:      workRegion      === '' ? null : workRegion,
      homeRegion:      homeRegion      === '' ? null : homeRegion,
      preferredRegion: preferredRegion === '' ? null : preferredRegion,
      showIncomeBorder,
    })

    setSaving(false)
    if (!result.ok) {
      setSaveMsg('儲存失敗，請稍後再試')
      setTimeout(() => setSaveMsg(''), 3000)
      return
    }
    setSaveMsg('已儲存 ✓')
    setTimeout(() => setSaveMsg(''), 1800)

    const updated: ProfileRow = {
      ...profile,
      name: name.trim(),
      bio: bio.trim(),
      questionnaire: qa.length > 0 ? qa : profile.questionnaire,
      photo_urls: uploadedPaths.length > 0 ? uploadedPaths : profile.photo_urls,
      work_region:      workRegion      === '' ? null : workRegion,
      home_region:      homeRegion      === '' ? null : homeRegion,
      preferred_region: preferredRegion === '' ? null : preferredRegion,
      show_income_border: showIncomeBorder,
    }
    onSaved(updated)
  }

  return createPortal(
    <motion.div
      className="fixed inset-0 z-[100] bg-[#fafafa] flex flex-col"
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', stiffness: 320, damping: 36 }}
    >
      {/* Sticky header */}
      <div className="flex-shrink-0 flex items-center justify-between px-5 pt-safe pb-3 bg-[#fafafa] border-b border-slate-100">
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={onClose}
          className="w-9 h-9 rounded-full bg-white ring-1 ring-slate-100 shadow-sm flex items-center justify-center"
        >
          <ChevronLeft className="w-5 h-5 text-slate-600" />
        </motion.button>

        <span className="font-bold text-slate-900 text-[15px]">編輯個人資訊</span>

        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={save}
          disabled={!name.trim() || saving}
          className={cn(
            'flex items-center gap-1.5 px-4 py-2 rounded-2xl text-sm font-bold transition-all',
            name.trim() && !saving
              ? 'bg-slate-900 text-white shadow-md shadow-slate-900/20'
              : 'bg-slate-100 text-slate-300',
          )}
        >
          {saving
            ? <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.9, ease: 'linear' }}><Cpu className="w-4 h-4" /></motion.div>
            : <Check className="w-4 h-4" />}
          {saveMsg || '儲存'}
        </motion.button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-6" style={{ WebkitOverflowScrolling: 'touch' }}>

        {/* ── 基本資料 ─────────────────────────────────── */}
        <section>
          <SectionHeading label="基本資料" />

          <div className="space-y-3">
            <div>
              <label className="field-label">姓名 <span className="text-red-400">*</span></label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onFocus={(e) => { const el = e.currentTarget; setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300) }}
                placeholder="你的名字"
                className="field-input"
              />
            </div>

            <div>
              <label className="field-label">自我介紹</label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                onFocus={(e) => { const el = e.currentTarget; setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300) }}
                placeholder="用幾句話介紹自己⋯"
                rows={4}
                className="field-input resize-none leading-relaxed"
              />
            </div>
          </div>
        </section>

        {/* ── 地點 ─────────────────────────────────────── */}
        <section>
          <SectionHeading label="地點" hint="影響配對範圍" />

          <div className="space-y-4">
            <div>
              <label className="field-label">工作地點</label>
              <EditRegionGrid value={workRegion} onChange={setWorkRegion} />
            </div>
            <div>
              <label className="field-label">戶籍地</label>
              <EditRegionGrid value={homeRegion} onChange={setHomeRegion} />
            </div>
            <div>
              <label className="field-label">希望配對的對象所在地</label>
              <EditRegionGrid value={preferredRegion} onChange={setPreferredRegion} />
              <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
                對方的工作地或戶籍地其中一個符合就會出現在探索頁
              </p>
            </div>
          </div>
        </section>

        {/* ── 生活照 ───────────────────────────────────── */}
        <section>
          <SectionHeading label="生活照" hint={`${photos.length} / 5 張`} />

          <div className="grid grid-cols-3 gap-2">
            {photos.map((photo) => (
              <div key={photo.id} className="relative aspect-square rounded-2xl overflow-hidden bg-slate-100">
                <img
                  src={photo.previewUrl}
                  alt=""
                  className="w-full h-full object-cover scale-110"
                  style={{ filter: 'blur(6px)' }}
                />
                <div className="absolute inset-0 bg-black/10" />
                <div className="absolute left-2 right-2 bottom-2 rounded-xl bg-white/80 backdrop-blur-sm px-2.5 py-1.5">
                  <p className="text-[10px] font-semibold text-slate-700 text-center tracking-wide">
                    隱私保護預覽
                  </p>
                </div>
                <button
                  onClick={() => removePhoto(photo.id)}
                  className="absolute top-1.5 right-1.5 w-6 h-6 bg-black/50 backdrop-blur rounded-full flex items-center justify-center"
                >
                  <Trash2 className="w-3 h-3 text-white" />
                </button>
              </div>
            ))}

            {photos.length < 5 && (
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={() => photoInputRef.current?.click()}
                className="aspect-square rounded-2xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center gap-1 bg-white"
              >
                <Camera className="w-5 h-5 text-slate-300" />
                <span className="text-[10px] text-slate-300 font-medium">新增照片</span>
              </motion.button>
            )}

            {photos.length === 0 && (
              <div className="col-span-2 aspect-[2/1] rounded-2xl border-2 border-dashed border-slate-100 flex items-center justify-center bg-slate-50">
                <div className="text-center">
                  <ImageIcon className="w-8 h-8 text-slate-200 mx-auto mb-1" />
                  <p className="text-xs text-slate-300">最多上傳 5 張生活照</p>
                </div>
              </div>
            )}
          </div>

          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => addPhotos(e.target.files)}
          />
          <p className="text-xs text-slate-400 mt-2">上傳預覽會先以霧化方式顯示，正式照片會保留原始清晰版本。</p>
        </section>

        {/* ── 收入認證 邊框特效 ─────────────────────────── */}
        <section>
          <SectionHeading label="收入認證邊框特效" hint={profile.income_tier ? '可切換顯示' : undefined} />

          {profile.income_tier ? (
            <div className="bg-white rounded-3xl p-4 shadow-sm ring-1 ring-slate-100 space-y-3">
              {/* Preview with/without border */}
              <div className="flex items-center gap-4">
                <IncomeBorder
                  tier={showIncomeBorder ? profile.income_tier : null}
                  radius="0.75rem"
                  thickness={6}
                >
                  <div className="w-20 h-20 bg-slate-100 flex items-center justify-center text-slate-400 font-black text-xl">
                    {(profile.name ?? '?').charAt(0)}
                  </div>
                </IncomeBorder>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-900 leading-tight flex items-center gap-1.5">
                    <Gem className="w-4 h-4 text-slate-600" />
                    {INCOME_TIER_META[profile.income_tier].label}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {INCOME_TIER_META[profile.income_tier].range}
                  </p>
                  <p className="text-[11px] text-emerald-500 mt-0.5 font-semibold">✓ 已通過審核</p>
                </div>
              </div>

              {/* Toggle */}
              <button
                onClick={() => setShowIncomeBorder((v) => !v)}
                className={cn(
                  'w-full py-3 rounded-2xl text-sm font-bold flex items-center justify-between px-4 transition-all',
                  showIncomeBorder
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600',
                )}
              >
                <span>{showIncomeBorder ? '已啟用邊框特效' : '未啟用'}</span>
                <div className={cn(
                  'w-11 h-6 rounded-full p-0.5 transition-all',
                  showIncomeBorder ? 'bg-white/30' : 'bg-slate-300',
                )}>
                  <div className={cn(
                    'w-5 h-5 rounded-full bg-white transition-all',
                    showIncomeBorder && 'translate-x-5',
                  )} />
                </div>
              </button>
              <p className="text-[11px] text-slate-400 leading-relaxed px-1">
                啟用後，所有人看你的照片都會加上 {INCOME_TIER_META[profile.income_tier].short} 。
              </p>
            </div>
          ) : incomeStatus?.status === 'pending' ? (
            <div className="bg-amber-50 rounded-2xl p-4 ring-1 ring-amber-100">
              <p className="text-sm font-bold text-amber-800 flex items-center gap-2">
                <Sparkles className="w-4 h-4" />
                收入認證審核中
              </p>
              <p className="text-xs text-amber-700/70 mt-1 leading-relaxed">
                你申請的 {incomeStatus.claimed ? INCOME_TIER_META[incomeStatus.claimed].label : '收入'} 正在審核。{incomeReviewCountdown > 0 ? `AI 審核倒數 ${incomeReviewCountdown} 秒。` : `AI 審核時間為 ${AI_REVIEW_SECONDS} 秒；若 AI 無法確認，會轉人工審核，人工審核時間可能大於 12 小時。`}
              </p>
            </div>
          ) : (
            /* Rejected or not yet submitted — show upload form */
            <div className="bg-white rounded-2xl p-4 ring-1 ring-slate-100 shadow-sm space-y-4">
              {!canSubmitIncomeVerification && (
                <div className="bg-slate-50 rounded-xl px-3 py-2.5 ring-1 ring-slate-100">
                  <p className="text-xs font-bold text-slate-600">請先完成職業資料認證，通過後才能申請薪資收入審核。</p>
                </div>
              )}
              {incomeStatus?.status === 'rejected' && (
                <div className="bg-rose-50 rounded-xl px-3 py-2.5 ring-1 ring-rose-100">
                  <p className="text-xs font-bold text-rose-700">上次送審未通過，請重新上傳更清晰的文件</p>
                </div>
              )}
              <div>
                <p className="text-sm font-bold text-slate-800 flex items-center gap-2 mb-3">
                  <Gem className="w-4 h-4 text-slate-500" />
                  上傳收入證明文件
                </p>
                <p className="text-[11px] text-slate-400 mb-3 leading-relaxed">
                  可上傳薪資單、扣繳憑單、銀行對帳單等。AI 審核時間為 {AI_REVIEW_SECONDS} 秒；送出後會顯示倒數。若 AI 無法確認，會轉人工審核，人工審核時間可能大於 12 小時。
                </p>

                {/* Tier picker */}
                <p className="text-xs font-semibold text-slate-600 mb-2">選擇申請等級</p>
                <div className="grid grid-cols-3 gap-2 mb-4">
                  {(['silver','gold','diamond'] as IncomeTier[]).map((t) => (
                    <button
                      key={t}
                      onClick={() => setIncomeUploadTier(t)}
                      className={cn(
                        'rounded-xl p-2.5 text-center ring-1 transition-all',
                        incomeUploadTier === t
                          ? 'ring-slate-900 bg-slate-900 text-white'
                          : 'ring-slate-200 bg-white text-slate-700',
                      )}
                    >
                      <p className="text-xs font-bold leading-tight">{INCOME_TIER_META[t].label}</p>
                      <p className="text-[10px] opacity-70 mt-0.5 leading-tight">{INCOME_TIER_META[t].range}</p>
                    </button>
                  ))}
                </div>

                {/* File upload */}
                <input
                  ref={incomeDocRef}
                  type="file"
                  accept="image/*,.pdf"
                  className="hidden"
                  disabled={!canSubmitIncomeVerification}
                  onChange={(e) => setIncomeUploadFile(e.target.files?.[0] ?? null)}
                />
                <button
                  onClick={() => canSubmitIncomeVerification && incomeDocRef.current?.click()}
                  disabled={!canSubmitIncomeVerification}
                  className={cn(
                    'w-full rounded-2xl border-2 border-dashed py-4 flex flex-col items-center gap-1.5 transition-all',
                    !canSubmitIncomeVerification
                      ? 'border-slate-100 bg-slate-50 opacity-60 cursor-not-allowed'
                      : incomeUploadFile ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-slate-50',
                  )}
                >
                  {incomeUploadFile ? (
                    <>
                      <FileText className="w-5 h-5 text-emerald-500" />
                      <p className="text-xs font-semibold text-emerald-700 truncate max-w-[200px]">{incomeUploadFile.name}</p>
                      <p className="text-[10px] text-emerald-500">點擊重新選擇</p>
                    </>
                  ) : (
                    <>
                      <Upload className="w-5 h-5 text-slate-300" />
                      <p className="text-xs text-slate-400 font-medium">點擊上傳照片或 PDF</p>
                      <p className="text-[10px] text-slate-300">AI 審核時間為 {AI_REVIEW_SECONDS} 秒，送出後倒數</p>
                    </>
                  )}
                </button>

                {incomeSubmitMsg && (
                  <div className={cn(
                    'mt-3 rounded-2xl px-4 py-3 ring-1',
                    incomeSubmitMsg.includes('上限') || incomeSubmitMsg.includes('人工') || incomeSubmitMsg.includes('拒絕')
                      ? 'bg-amber-50 ring-amber-100'
                      : 'bg-blue-50 ring-blue-100',
                  )}>
                    <p className="text-xs font-medium leading-relaxed text-slate-700">{incomeSubmitMsg}</p>
                  </div>
                )}

                {/* Submit */}
                <button
                  onClick={submitIncome}
                  disabled={!canSubmitIncomeVerification || !incomeUploadTier || !incomeUploadFile || uploadingIncome}
                  className={cn(
                    'mt-3 w-full py-3 rounded-2xl text-sm font-bold flex items-center justify-center gap-2 transition-all',
                    canSubmitIncomeVerification && incomeUploadTier && incomeUploadFile && !uploadingIncome
                      ? 'bg-slate-900 text-white shadow-md shadow-slate-900/20'
                      : 'bg-slate-100 text-slate-300',
                  )}
                >
                  {uploadingIncome
                    ? <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.9, ease: 'linear' }}><Cpu className="w-4 h-4" /></motion.div>
                    : <ShieldCheck className="w-4 h-4" />}
                  {uploadingIncome ? '上傳中⋯' : '送出認證申請'}
                </button>
              </div>
            </div>
          )}
        </section>

        {/* ── 價值觀問答 ────────────────────────────────── */}
        {qa.length > 0 && (
          <section>
            <SectionHeading label="價值觀問答" hint="可修改你的答案" />

            <div className="space-y-4">
              {qa.map((entry, i) => (
                <div key={entry.id} className="bg-white rounded-3xl p-4 shadow-sm ring-1 ring-slate-100">
                  <div className="flex items-start gap-2 mb-3">
                    <span className="w-5 h-5 rounded-md bg-slate-900 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-white text-[9px] font-black">Q{i + 1}</span>
                    </span>
                    <p className="text-[13px] font-semibold text-slate-800 leading-snug">{entry.text}</p>
                  </div>
                  <textarea
                    value={entry.answer}
                    onChange={(e) => updateAnswer(i, e.target.value)}
                    onFocus={(e) => { const el = e.currentTarget; setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300) }}
                    rows={4}
                    placeholder="修改你的回答⋯"
                    className="w-full text-sm text-slate-700 placeholder:text-slate-300 leading-relaxed bg-slate-50 rounded-2xl px-3.5 py-3 outline-none focus:ring-1 focus:ring-slate-300 transition resize-none"
                  />
                  <p className="text-[10px] text-slate-300 text-right mt-1">{entry.answer.length} 字</p>
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="h-6" />
      </div>
    </motion.div>,
    document.body,
  )
}

// ─── Company Verify Screen ────────────────────────────────────────────────────

const COMPANY_DOC_TYPES: { value: 'employee_id' | 'tax_return' | 'payslip'; label: string }[] = [
  { value: 'employee_id', label: '員工證 / 識別證' },
  { value: 'tax_return',  label: '扣繳憑單' },
  { value: 'payslip',     label: '薪資單' },
]

function CompanyVerifyScreen({
  profile, userId, onClose, onVerified,
}: {
  profile: ProfileRow
  userId: string
  onClose: () => void
  onVerified: (updated: ProfileRow) => void
}) {
  const isApproved  = profile.verification_status === 'approved'
  const isSubmitted = profile.verification_status === 'submitted'

  const [selectedCompany, setSelectedCompany] = useState<'TSMC' | 'MediaTek' | ''>('TSMC')
  const [selectedDocType, setSelectedDocType]   = useState<'employee_id' | 'tax_return' | 'payslip' | ''>('')
  const [docFile, setDocFile]   = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted]   = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [aiMessage, setAiMessage] = useState('')
  const [companyReviewCountdown, setCompanyReviewCountdown] = useState(0)
  const [linkedIncomeTier, setLinkedIncomeTier] = useState<IncomeTier | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const canLinkIncomeVerification = selectedDocType === 'tax_return' || selectedDocType === 'payslip'

  useEffect(() => {
    if (companyReviewCountdown <= 0) return
    const timer = window.setTimeout(() => setCompanyReviewCountdown((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [companyReviewCountdown])

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })

  const fileToEnhancedBase64 = (file: File): Promise<string> =>
    new Promise((resolve) => {
      if (!file.type.startsWith('image/')) {
        fileToBase64(file).then(resolve)
        return
      }

      const img = new Image()
      const objectUrl = URL.createObjectURL(file)
      img.onload = () => {
        URL.revokeObjectURL(objectUrl)
        const maxSide = 2600
        const scale = Math.min(3, Math.max(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight)))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.naturalWidth * scale)
        canvas.height = Math.round(img.naturalHeight * scale)
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          fileToBase64(file).then(resolve)
          return
        }
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        ctx.filter = 'contrast(1.22) brightness(1.06) saturate(0.85)'
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.95))
      }
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl)
        fileToBase64(file).then(resolve)
      }
      img.src = objectUrl
    })

  const verifyCompanyDocWithAI = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      return {
        passed: false,
        company: null,
        confidence: null,
        reason: 'PDF 文件無法即時 AI 審核，已轉人工審核。人工審核時間可能大於 12 小時。',
      } as const
    }

    setAiMessage('AI 正在辨識員工證⋯')
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 5 * 60 * 1000)
    try {
      const imageBase64 = await fileToEnhancedBase64(file)
      const response = await fetch('/api/verify-id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64,
          verificationKind: 'employment',
          claimedName: profile.name ?? undefined,
          claimedCompany: selectedCompany || undefined,
          docType: selectedDocType || undefined,
        }),
        signal: controller.signal,
      })
      const data = await response.json() as {
        ok: boolean
        company?: string
        confidence?: string
        suggestedIncomeTier?: string | null
        message: string
        reason?: string
      }

      const aiCompany: Company | null = data.company === 'TSMC' || data.company === 'MediaTek' ? data.company : null
      const aiConfidence: AiConfidence | null = data.confidence === 'high' || data.confidence === 'medium' || data.confidence === 'low'
        ? data.confidence
        : null

      return {
        passed: data.ok,
        company: aiCompany,
        confidence: aiConfidence,
        suggestedIncomeTier: toIncomeTier(data.suggestedIncomeTier),
        reason: data.reason ?? data.message,
      }
    } finally {
      window.clearTimeout(timeout)
    }
  }

  const verifyLinkedIncomeWithAI = async (file: File, tier: IncomeTier) => {
    if (!file.type.startsWith('image/')) {
      return {
        passed: false,
        company: null,
        confidence: null,
        reason: 'PDF 文件將由人工審核確認。人工審核時間可能大於 12 小時。',
      } as const
    }

    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 5 * 60 * 1000)
    try {
      const imageBase64 = await fileToEnhancedBase64(file)
      const response = await fetch('/api/verify-id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64,
          verificationKind: 'income',
          claimedIncomeTier: tier,
          claimedName: profile.name ?? undefined,
          claimedCompany: selectedCompany || profile.company || undefined,
          docType: selectedDocType || undefined,
        }),
        signal: controller.signal,
      })
      const data = await response.json() as {
        ok: boolean
        confidence?: string
        suggestedIncomeTier?: string | null
        message: string
        reason?: string
      }
      const aiConfidence: AiConfidence | null = data.confidence === 'high' || data.confidence === 'medium' || data.confidence === 'low'
        ? data.confidence
        : null
      return {
        passed: data.ok,
        company: null,
        confidence: aiConfidence,
        suggestedIncomeTier: toIncomeTier(data.suggestedIncomeTier),
        reason: data.reason ?? data.message,
      }
    } finally {
      window.clearTimeout(timeout)
    }
  }

  const submit = async () => {
    if (!selectedCompany || !selectedDocType || !docFile) return
    setSubmitError('')
    setAiMessage('')
    setSubmitting(true)
    const count = await getTodayVerificationSubmissionCount(userId)
    if (count >= 20) {
      setSubmitError('今天已達送審上限 20 次，請明天再試。')
      setSubmitting(false)
      return
    }

    const optimisticCompany = selectedCompany
    setSubmitted(true)
    setCompanyReviewCountdown(AI_REVIEW_SECONDS)
    setAiMessage(`AI 審核倒數 ${AI_REVIEW_SECONDS} 秒。`)
    onVerified({ ...profile, company: optimisticCompany, verification_status: 'submitted' })

    let aiResult: Awaited<ReturnType<typeof verifyCompanyDocWithAI>>
    let reviewMode: 'ai_auto' | 'manual' = 'manual'
    let manualReason = ''
    try {
      aiResult = await verifyCompanyDocWithAI(docFile)
    } catch {
      aiResult = {
        passed: false,
        company: null,
        confidence: null,
        suggestedIncomeTier: null,
        reason: 'AI 暫時無法完成審核，已轉人工審核。人工審核時間可能大於 12 小時。',
      }
    }

    if (!aiResult.passed) {
      manualReason = aiResult.reason || 'AI 初審未通過，已轉人工審核。人工審核時間可能大於 12 小時。'
      setAiMessage(manualReason)
    } else {
      if (selectedDocType === 'employee_id') {
        reviewMode = 'ai_auto'
        setAiMessage(`AI 審核中，AI 審核時間為 ${AI_REVIEW_SECONDS} 秒。`)
      } else {
        reviewMode = 'manual'
        manualReason = 'AI 已初步辨識文件內容；扣繳憑單/薪資單字體較小，需人工覆核公司與姓名後才會通過。人工審核時間可能大於 12 小時。'
        setAiMessage(manualReason)
      }
    }

    if (aiResult.company) setSelectedCompany(aiResult.company)

    const res = await uploadProofDoc(userId, docFile)
    if (!res.ok) {
      setSubmitError(`文件上傳失敗：${res.error}`)
      setSubmitted(false)
      setCompanyReviewCountdown(0)
      setSubmitting(false)
      setAiMessage('')
      return
    }

    const docResult = await submitVerificationDoc(
      userId,
      aiResult.company ?? selectedCompany,
      selectedDocType,
      res.path,
      aiResult,
      reviewMode,
      manualReason,
    )
    if (!docResult.ok) {
      setSubmitError(`送出審核失敗：${docResult.error ?? '請稍後再試'}`)
      setSubmitted(false)
      setCompanyReviewCountdown(0)
      setSubmitting(false)
      setAiMessage('')
      return
    }

    const autoIncomeTier = reviewMode === 'ai_auto' && canLinkIncomeVerification
      ? linkedIncomeTier ?? toIncomeTier('suggestedIncomeTier' in aiResult ? aiResult.suggestedIncomeTier : null)
      : null

    if (canLinkIncomeVerification && autoIncomeTier) {
      let incomeAiResult: Awaited<ReturnType<typeof verifyLinkedIncomeWithAI>>
      let incomeReviewMode: 'ai_auto' | 'manual' = 'manual'
      let incomeManualReason = ''
      try {
        incomeAiResult = await verifyLinkedIncomeWithAI(docFile, autoIncomeTier)
      } catch {
        incomeAiResult = {
          passed: false,
          company: null,
          confidence: null,
          suggestedIncomeTier: null,
          reason: 'AI 暫時無法完成收入審核，已轉人工審核。人工審核時間可能大於 12 小時。',
        }
      }
      if (incomeAiResult.passed) {
        incomeReviewMode = 'ai_auto'
      } else {
        incomeManualReason = incomeAiResult.reason || 'AI 未通過，已轉人工審核。人工審核時間可能大於 12 小時。'
      }
      await submitIncomeVerification(
        userId,
        autoIncomeTier,
        selectedDocType,
        res.path,
        incomeAiResult,
        incomeReviewMode,
        incomeManualReason,
      )
    }

    onVerified({ ...profile, company: aiResult.company ?? selectedCompany, verification_status: 'submitted' })
    setSubmitting(false)
    if (reviewMode === 'ai_auto') setAiMessage('')
  }

  return createPortal(
    <motion.div
      className="fixed inset-0 z-[100] bg-[#fafafa] flex flex-col"
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', stiffness: 320, damping: 36 }}
    >
      {/* Header */}
      <div className="flex-shrink-0 flex items-center gap-3 px-5 pt-safe pb-3 bg-[#fafafa] border-b border-slate-100">
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={onClose}
          className="w-9 h-9 rounded-full bg-white ring-1 ring-slate-100 shadow-sm flex items-center justify-center"
        >
          <ChevronLeft className="w-5 h-5 text-slate-600" />
        </motion.button>
        <span className="font-bold text-slate-900 text-[15px]">公司認證</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-5">
        {/* Status banner */}
        {isApproved ? (
          <div className="bg-emerald-50 rounded-2xl p-4 ring-1 ring-emerald-100 flex items-center gap-3">
            <ShieldCheck className="w-6 h-6 text-emerald-500 flex-shrink-0" />
            <div>
              <p className="text-sm font-bold text-emerald-800">公司認證已通過</p>
              <p className="text-xs text-emerald-600 mt-0.5">你的 {profile.company} 員工身份已驗證</p>
            </div>
          </div>
        ) : isSubmitted || submitted ? (
          <div className="bg-amber-50 rounded-2xl p-4 ring-1 ring-amber-100 flex items-center gap-3">
            <Sparkles className="w-6 h-6 text-amber-500 flex-shrink-0" />
            <div>
              <p className="text-sm font-bold text-amber-800">審核中</p>
              <p className="text-xs text-amber-600 mt-0.5">
                文件已送出。{companyReviewCountdown > 0 ? `AI 審核倒數 ${companyReviewCountdown} 秒。` : (aiMessage || `AI 審核時間為 ${AI_REVIEW_SECONDS} 秒；若 AI 無法確認，會轉人工審核，人工審核時間可能大於 12 小時。`)}
              </p>
            </div>
          </div>
        ) : (
          <div className="bg-blue-50 rounded-2xl p-4 ring-1 ring-blue-100">
            <p className="text-sm font-bold text-blue-800">上傳公司驗證文件</p>
            <p className="text-xs text-blue-600 mt-1 leading-relaxed">
              上傳員工識別證、扣繳憑單或薪資單。AI 審核時間為 {AI_REVIEW_SECONDS} 秒；送出後會顯示倒數。若 AI 無法確認，會轉人工審核，人工審核時間可能大於 12 小時。
            </p>
          </div>
        )}

        {/* Upload form — hidden when already approved/submitted */}
        {!isApproved && !isSubmitted && !submitted && (
          <div className="bg-white rounded-2xl p-4 ring-1 ring-slate-100 shadow-sm space-y-4">
            {/* Company select */}
            <div>
              <p className="text-xs font-semibold text-slate-600 mb-2">選擇公司</p>
              <div className="grid grid-cols-2 gap-2">
                {(['TSMC', 'MediaTek'] as const).map((c) => (
                  <button
                    key={c}
                    onClick={() => setSelectedCompany(c)}
                    className={cn(
                      'py-3 rounded-xl text-sm font-bold ring-1 transition-all',
                      selectedCompany === c
                        ? 'bg-slate-900 text-white ring-slate-900'
                        : 'bg-white text-slate-700 ring-slate-200',
                    )}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            {/* Doc type select */}
            <div>
              <p className="text-xs font-semibold text-slate-600 mb-2">文件類型</p>
              <div className="space-y-2">
                {COMPANY_DOC_TYPES.map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => {
                      setSelectedDocType(value)
                      if (value === 'employee_id') setLinkedIncomeTier(null)
                    }}
                    className={cn(
                      'w-full flex items-center gap-3 px-4 py-3 rounded-xl ring-1 transition-all text-left',
                      selectedDocType === value
                        ? 'bg-slate-900 text-white ring-slate-900'
                        : 'bg-white text-slate-700 ring-slate-200',
                    )}
                  >
                    <FileText className="w-4 h-4 flex-shrink-0" />
                    <span className="text-sm font-medium">{label}</span>
                    {selectedDocType === value && <Check className="w-4 h-4 ml-auto" />}
                  </button>
                ))}
              </div>
            </div>

            {canLinkIncomeVerification && (
              <div className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-100">
                <p className="text-xs font-bold text-slate-700 mb-1.5">同步收入認證</p>
                <p className="text-[11px] text-slate-400 leading-relaxed mb-3">
                  這份文件若能看出薪資，可同時審核收入等級。AI 通過後收入認證也會進入 {AI_REVIEW_SECONDS} 秒倒數。
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {(['silver','gold','diamond'] as IncomeTier[]).map((tier) => (
                    <button
                      key={tier}
                      onClick={() => setLinkedIncomeTier(tier)}
                      className={cn(
                        'rounded-xl px-2 py-2 text-center ring-1 transition-all',
                        linkedIncomeTier === tier
                          ? 'bg-slate-900 text-white ring-slate-900'
                          : 'bg-white text-slate-600 ring-slate-200',
                      )}
                    >
                      <p className="text-[11px] font-bold leading-tight">{INCOME_TIER_META[tier].label}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* File upload */}
            <div>
              <p className="text-xs font-semibold text-slate-600 mb-2">上傳文件</p>
              <input
                ref={fileRef}
                type="file"
                accept="image/*,.pdf"
                className="hidden"
                onChange={(e) => setDocFile(e.target.files?.[0] ?? null)}
              />
              <button
                onClick={() => fileRef.current?.click()}
                className={cn(
                  'w-full rounded-2xl border-2 border-dashed py-5 flex flex-col items-center gap-2 transition-all',
                  docFile ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-slate-50',
                )}
              >
                {docFile ? (
                  <>
                    <FileText className="w-6 h-6 text-emerald-500" />
                    <p className="text-xs font-semibold text-emerald-700 truncate max-w-[220px]">{docFile.name}</p>
                    <p className="text-[10px] text-emerald-500">點擊重新選擇</p>
                  </>
                ) : (
                  <>
                    <Upload className="w-6 h-6 text-slate-300" />
                    <p className="text-sm text-slate-400 font-medium">點擊上傳照片或 PDF</p>
                    <p className="text-[11px] text-slate-300">AI 審核時間為 {AI_REVIEW_SECONDS} 秒，送出後倒數</p>
                  </>
                )}
              </button>
            </div>

            {/* Submit */}
            {submitError && (
              <div className="rounded-2xl bg-red-50 px-4 py-3 ring-1 ring-red-100">
                <p className="text-xs font-medium leading-relaxed text-red-600">{submitError}</p>
              </div>
            )}

            {aiMessage && (
              <div className="rounded-2xl bg-blue-50 px-4 py-3 ring-1 ring-blue-100">
                <p className="text-xs font-medium leading-relaxed text-blue-700">
                  {companyReviewCountdown > 0 ? `AI 審核倒數 ${companyReviewCountdown} 秒。` : aiMessage}
                </p>
              </div>
            )}

            <button
              onClick={submit}
              disabled={!selectedCompany || !selectedDocType || !docFile || submitting}
              className={cn(
                'w-full py-3.5 rounded-2xl text-sm font-bold flex items-center justify-center gap-2 transition-all',
                selectedCompany && selectedDocType && docFile && !submitting
                  ? 'bg-slate-900 text-white shadow-md shadow-slate-900/20'
                  : 'bg-slate-100 text-slate-300',
              )}
            >
              {submitting
                ? <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.9, ease: 'linear' }}><Cpu className="w-4 h-4" /></motion.div>
                : <ShieldCheck className="w-4 h-4" />}
              {submitting ? '上傳中⋯' : '送出認證申請'}
            </button>
          </div>
        )}
      </div>
    </motion.div>,
    document.body,
  )
}

function SectionHeading({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">{label}</h3>
      {hint && <span className="text-xs text-slate-400">{hint}</span>}
    </div>
  )
}

// ─── Profile Tab ──────────────────────────────────────────────────────────────

function ProfileTab({ userId, onSignOut }: { userId: string; onSignOut: () => void }) {
  const [profile, setProfile] = useState<ProfileRow | null>(null)
  const [editing, setEditing] = useState(false)
  const [photoUrls, setPhotoUrls] = useState<string[]>([])
  const [showNotif, setShowNotif] = useState(false)
  const [showCompanyVerify, setShowCompanyVerify] = useState(false)
  const [showAdmin, setShowAdmin] = useState(false)
  const [appNotifications, setAppNotifications] = useState<AppNotificationRow[]>([])

  useEffect(() => {
    const load = async () => {
      await finalizeDueAiReviews()
      const latest = await getProfile(userId)
      setProfile(latest)
    }
    load()
  }, [userId])

  useEffect(() => {
    if (!userId) return
    const loadNotifications = async () => {
      await finalizeDueAiReviews()
      const latest = await getProfile(userId)
      if (latest) setProfile(latest)
      const notifications = await getUnreadAppNotifications(userId)
      setAppNotifications(notifications)
    }
    loadNotifications()
    const intervalId = window.setInterval(loadNotifications, 5_000)
    return () => window.clearInterval(intervalId)
  }, [userId, profile?.verification_status, profile?.income_tier])

  const dismissAppNotification = async (notificationId: string) => {
    setAppNotifications((prev) => prev.filter((n) => n.id !== notificationId))
    await markAppNotificationRead(notificationId)
  }

  useEffect(() => {
    let cancelled = false

    const loadPhotoUrls = async () => {
      const paths = profile?.photo_urls ?? []
      if (paths.length === 0) {
        setPhotoUrls([])
        return
      }

      const urls = await resolvePhotoUrls(paths)
      if (!cancelled) setPhotoUrls(urls)
    }

    loadPhotoUrls()
    return () => { cancelled = true }
  }, [profile?.photo_urls])

  const displayName = profile?.name ?? '—'
  const initials = displayName !== '—' ? displayName.charAt(0) : '?'
  const interests = profile?.interests ?? []
  const bio = profile?.bio ?? ''
  const verStatus = profile?.verification_status ?? 'pending'

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Scrollable profile body — logout lives in the footer below so it is never
          covered when the viewport height is wrong on iOS PWA cold start. */}
      <div className="flex-1 min-h-0 overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
      {/* Hero */}
      <div className="mx-4 mt-4 rounded-3xl overflow-hidden relative"
        style={{ background: 'linear-gradient(160deg, #1e293b, #334155)', minHeight: 160 }}
      >
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
        <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between">
          <div className="flex items-end gap-3">
            <IncomeBorder
              tier={(profile?.show_income_border && profile?.income_tier) ? profile.income_tier : null}
              radius="0.75rem"
              thickness={5}
              showVerifyMark={false}
            >
              <div className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center text-white font-black text-2xl ring-2 ring-white/25">
                {initials}
              </div>
            </IncomeBorder>
            <div>
              <h2 className="text-lg font-bold text-white leading-tight">{displayName}</h2>
              <p className="text-xs text-white/50 mt-0.5">
                {profile?.income_tier
                  ? (profile.show_income_border ? `⋄ ${INCOME_TIER_META[profile.income_tier].short}` : INCOME_TIER_META[profile.income_tier].label)
                  : verStatus === 'approved' ? '✅ 已驗證' : verStatus === 'submitted' ? '審核中' : '待驗證'}
              </p>
            </div>
          </div>
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => setEditing(true)}
            className="w-9 h-9 rounded-full bg-white/15 backdrop-blur flex items-center justify-center ring-1 ring-white/20"
          >
            <Pencil className="w-4 h-4 text-white" />
          </motion.button>
        </div>
      </div>

      {/* Bio */}
      {appNotifications.length > 0 && (
        <div className="mx-4 mt-3 space-y-2">
          {appNotifications.map((notification) => (
            <motion.div
              key={notification.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn(
                'rounded-2xl p-4 shadow-sm ring-1',
                notification.kind === 'verification_approved'
                  ? 'bg-emerald-50 ring-emerald-100'
                  : 'bg-red-50 ring-red-100',
              )}
            >
              <div className="flex items-start gap-3">
                {notification.kind === 'verification_approved'
                  ? <ShieldCheck className="mt-0.5 h-5 w-5 flex-shrink-0 text-emerald-600" />
                  : <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-500" />}
                <div className="min-w-0 flex-1">
                  <p className={cn(
                    'text-sm font-bold',
                    notification.kind === 'verification_approved' ? 'text-emerald-800' : 'text-red-700',
                  )}>
                    {notification.title}
                  </p>
                  <p className={cn(
                    'mt-1 text-xs leading-relaxed',
                    notification.kind === 'verification_approved' ? 'text-emerald-700' : 'text-red-600',
                  )}>
                    {notification.body}
                  </p>
                </div>
                <button
                  onClick={() => dismissAppNotification(notification.id)}
                  className="rounded-full bg-white/70 px-3 py-1.5 text-[11px] font-semibold text-slate-500"
                >
                  已讀
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Bio */}
      {bio ? (
        <div className="mx-4 mt-3 bg-white rounded-2xl px-4 py-3.5 shadow-sm ring-1 ring-slate-100">
          <p className="text-sm text-slate-700 leading-relaxed">{bio}</p>
        </div>
      ) : null}

      {/* Photos */}
      {photoUrls.length > 0 && (
        <div className="mx-4 mt-3 bg-white rounded-2xl p-4 shadow-sm ring-1 ring-slate-100">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">生活照</p>
          <div className="grid grid-cols-3 gap-2">
            {photoUrls.map((url, i) => (
              <div key={`${url}-${i}`} className="aspect-square rounded-2xl overflow-hidden bg-slate-100">
                <img src={url} alt="" className="w-full h-full object-cover" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Interests */}
      {interests.length > 0 && (
        <div className="mx-4 mt-3 bg-white rounded-2xl p-4 shadow-sm ring-1 ring-slate-100">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">興趣</p>
          <div className="flex flex-wrap gap-2">
            {interests.map((b) => (
              <span key={b} className="px-3 py-1 bg-slate-50 ring-1 ring-slate-200 rounded-full text-xs text-slate-700 font-medium">
                {b}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Actions (scroll) — 登出固定在下方 footer，避免被導覽列或視窗高度遮住 */}
      <div className="mx-4 mt-3 mb-4 bg-white rounded-2xl shadow-sm ring-1 ring-slate-100 overflow-hidden">
        <motion.button
          whileTap={{ backgroundColor: '#f8fafc' }}
          onClick={() => setEditing(true)}
          className="w-full flex items-center gap-3 px-4 py-3.5 text-sm text-slate-700 border-b border-slate-50"
        >
          <User className="w-4 h-4 text-slate-400" />
          <span>編輯個人資訊</span>
        </motion.button>
        <motion.button
          whileTap={{ backgroundColor: '#f8fafc' }}
          onClick={() => setShowNotif(true)}
          className="w-full flex items-center gap-3 px-4 py-3.5 text-sm text-slate-700 border-b border-slate-50"
        >
          <Bell className="w-4 h-4 text-slate-400" />
          <span>通知設定</span>
        </motion.button>
        <motion.button
          whileTap={{ backgroundColor: '#f8fafc' }}
          onClick={() => setShowCompanyVerify(true)}
          className="w-full flex items-center gap-3 px-4 py-3.5 text-sm text-slate-700"
        >
          <Cpu className="w-4 h-4 text-slate-400" />
          <span>公司認證</span>
          <ChevronRight className="w-4 h-4 text-slate-300 ml-auto" />
        </motion.button>
      </div>
      </div>

      {/* Logout — pinned above bottom tab bar, never inside scroll */}
      <div className="flex-shrink-0 px-4 pt-2 pb-1 bg-white border-t border-gray-200 space-y-2">
        {/* Admin entry — only visible for admin accounts */}
        {profile?.is_admin && (
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => setShowAdmin(true)}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-semibold text-slate-700 bg-slate-100 ring-1 ring-slate-200"
          >
            <ShieldCheck className="w-4 h-4" />
            <span>管理後台</span>
          </motion.button>
        )}
        <motion.button
          whileTap={{ backgroundColor: '#fff1f2' }}
          onClick={onSignOut}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-semibold text-red-600 bg-white ring-1 ring-red-100 shadow-sm"
        >
          <LogOut className="w-4 h-4" />
          <span>登出</span>
        </motion.button>
      </div>

      {/* Edit screen */}
      <AnimatePresence>
        {editing && profile && (
          <EditProfileScreen
            profile={profile}
            userId={userId}
            onClose={() => setEditing(false)}
            onSaved={(updated) => setProfile(updated)}
          />
        )}
      </AnimatePresence>

      {/* Company verify screen */}
      <AnimatePresence>
        {showCompanyVerify && profile && (
          <CompanyVerifyScreen
            profile={profile}
            userId={userId}
            onClose={() => setShowCompanyVerify(false)}
            onVerified={(updated) => setProfile(updated)}
          />
        )}
      </AnimatePresence>

      {/* Notification modal */}
      <AnimatePresence>
        {showNotif && <NotificationModal onClose={() => setShowNotif(false)} />}
      </AnimatePresence>

      {/* Admin screen */}
      <AnimatePresence>
        {showAdmin && (
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 260 }}
            className="fixed inset-0 z-50 bg-[#f5f5f7]"
          >
            <AdminScreen onBack={() => setShowAdmin(false)} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Bottom Navigation ────────────────────────────────────────────────────────

const NAV_ITEMS: { tab: Tab; icon: React.ElementType; label: string }[] = [
  { tab: 'discover', icon: Compass, label: '探索' },
  { tab: 'matches', icon: Heart, label: '配對' },
  { tab: 'messages', icon: MessageCircle, label: '訊息' },
  { tab: 'profile', icon: User, label: '我的' },
]

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function MainScreen({ user, onSignOut }: { user?: import('@supabase/supabase-js').User | null; onSignOut?: () => void }) {
  const [activeTab, setActiveTab] = useState<Tab>('discover')
  const prevTab = useRef<Tab>('discover')
  const [currentUserGender, setCurrentUserGender] = useState<'male' | 'female'>('male')
  const [currentUserPreferredRegion, setCurrentUserPreferredRegion] = useState<import('@/lib/types').Region | null>(null)
  const [hideTabBarForChatKeyboard, setHideTabBarForChatKeyboard] = useState(false)
  const [viewingPerson, setViewingPerson] = useState<PersonSummary | null>(null)
  const [pendingChatId, setPendingChatId] = useState<number | null>(null)
  const contentScrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (activeTab !== 'messages') setHideTabBarForChatKeyboard(false)
  }, [activeTab])

  // "Start chat with <id>" — jump to messages tab and tell MessagesTab which
  // conversation to auto-open. If the id isn't a known conversation yet (e.g.
  // future case: match without messages), we'll still switch tabs.
  const startChatWith = (id: number) => {
    setViewingPerson(null)
    setActiveTab('messages')
    setPendingChatId(id)
  }

  // Fetch current user's gender + preferred region to filter discover profiles
  useEffect(() => {
    if (!user?.id) return
    getProfile(user.id).then((profile) => {
      if (profile?.gender) setCurrentUserGender(profile.gender)
      setCurrentUserPreferredRegion((profile?.preferred_region as import('@/lib/types').Region | null) ?? null)
    })
  }, [user?.id])

  const handleSignOut = async () => {
    await signOut()
    onSignOut?.()
  }

  const tabContent: Record<Tab, React.ReactNode> = {
    discover: <DiscoverTab userId={user?.id} currentUserGender={currentUserGender} preferredRegion={currentUserPreferredRegion} contentScrollRef={contentScrollRef} />,
    matches: (
      <MatchesTab
        onOpenPerson={setViewingPerson}
        onStartChat={startChatWith}
      />
    ),
    messages: (
      <MessagesTab
        onChatInputFocus={() => setHideTabBarForChatKeyboard(true)}
        onChatInputBlur={() => setHideTabBarForChatKeyboard(false)}
        requestedConversationId={pendingChatId}
        onConversationOpened={() => setPendingChatId(null)}
        onOpenPerson={setViewingPerson}
      />
    ),
    profile: <ProfileTab userId={user?.id ?? ''} onSignOut={handleSignOut} />,
  }

  const showTabBar = !(activeTab === 'messages' && hideTabBarForChatKeyboard)

  return (
    <div className="max-w-md mx-auto w-full flex-1 flex flex-col min-h-0 bg-white">
      {/* Top bar */}
      <div className="flex-none flex items-center px-4 pb-3 pt-safe-bar border-b border-gray-200 bg-white">
        <div className="flex items-center gap-2 flex-1">
          <div className="w-8 h-8 bg-slate-900 rounded-lg flex items-center justify-center">
            <Cpu className="w-[18px] h-[18px] text-white" />
          </div>
          <span className="font-bold text-slate-900 tracking-tight text-lg leading-none">tsMedia</span>
          <span className="text-[11px] text-slate-400 ml-1 leading-none">Silicon Hearts</span>
        </div>
      </div>

      {/* Scrollable content — flex-1 */}
      <main
        ref={contentScrollRef}
        className="flex-1 min-h-0 overflow-y-auto"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            className="h-full flex flex-col"
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.18, ease: 'easeInOut' }}
          >
            {tabContent[activeTab]}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Bottom nav — plain flex child, no fixed/absolute.
          Inline padding-bottom fills the iOS home-indicator safe area. */}
      {showTabBar && (
        <nav
          className="w-full bg-white border-t border-gray-200"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <div className="h-[60px] max-w-md mx-auto flex justify-around items-center">
            {NAV_ITEMS.map(({ tab, icon: Icon, label }) => (
              <button
                key={tab}
                type="button"
                onClick={() => { prevTab.current = activeTab; setActiveTab(tab) }}
                className="flex-1 h-full flex flex-col items-center justify-center gap-0.5 relative"
              >
                {activeTab === tab && (
                  <motion.div
                    layoutId="nav-indicator"
                    className="absolute top-0 left-1/4 right-1/4 h-0.5 bg-slate-800 rounded-full"
                    transition={{ type: 'spring', stiffness: 400, damping: 35 }}
                  />
                )}
                <Icon className={cn('w-5 h-5 transition-colors', activeTab === tab ? 'text-slate-900' : 'text-slate-400')} />
                <span className={cn('text-[10px] font-medium transition-colors', activeTab === tab ? 'text-slate-900' : 'text-slate-400')}>
                  {label}
                </span>
              </button>
            ))}
          </div>
        </nav>
      )}

      {/* Partner profile overlay — shared by Matches & Messages taps */}
      <AnimatePresence>
        {viewingPerson && (
          <PersonDetailView
            key={viewingPerson.id}
            person={viewingPerson}
            onClose={() => setViewingPerson(null)}
            onStartChat={startChatWith}
          />
        )}
      </AnimatePresence>
    </div>
  )
}


