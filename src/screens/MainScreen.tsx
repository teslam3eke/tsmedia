import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Heart, X, MessageCircle, Compass, User,
  Sparkles, MapPin, Briefcase, GraduationCap,
  ChevronLeft, ChevronDown, Send, Bell,
  Cpu, Zap, LogOut, MessageSquare, Check, Pencil,
  Camera, Trash2, ImageIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { signOut } from '@/lib/auth'
import { getProfile, resolvePhotoUrls, upsertProfile, uploadPhoto } from '@/lib/db'
import type { ProfileRow, QuestionnaireEntry } from '@/lib/types'

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

const MATCHES = [
  { id: 101, name: '王雅婷', company: '理律法律事務所', role: '律師', initials: '王', lastMessage: '你也喜歡手沖嗎？我最近在練習 V60 ☕', time: '剛剛', unread: 2, from: '#7c3aed', to: '#6d28d9' },
  { id: 102, name: '劉承恩', company: 'TSMC', role: '製程研發工程師', initials: '劉', lastMessage: '週末要一起去陽明山嗎？', time: '14 分鐘', unread: 0, from: '#0f766e', to: '#0d9488' },
  { id: 103, name: '蔡佩如', company: 'MediaTek', role: '數位設計工程師', initials: '蔡', lastMessage: '那部紀錄片我也很想看！', time: '1 小時', unread: 1, from: '#b45309', to: '#d97706' },
]

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

function DiscoverTab({ currentUserGender }: { currentUserGender: 'male' | 'female' }) {
  // Men see female profiles, women see male profiles
  const visibleProfiles = PROFILES.filter((p) => p.gender !== currentUserGender)

  const [index, setIndex] = useState(0)
  const [direction, setDirection] = useState<'next' | 'prev'>('next')
  const [done, setDone] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  // Reset hint whenever we switch to a new card
  useEffect(() => { setScrolled(false) }, [index])

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

  const handleLike = () => goNext()
  const handlePass = () => goNext()

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
        <button className="w-9 h-9 rounded-full bg-white ring-1 ring-slate-100 shadow-sm flex items-center justify-center relative">
          <Bell className="w-4 h-4 text-slate-500" />
          <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-red-400 rounded-full" />
        </button>
      </div>

      {/* Card */}
      <div className="relative flex-1 overflow-hidden px-4 pb-2">
        <AnimatePresence mode="wait">
          <motion.div
            key={profile.id}
            initial={{ opacity: 0, x: direction === 'next' ? 60 : -60 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: direction === 'next' ? -60 : 60 }}
            transition={{ duration: 0.26, ease: [0.4, 0, 0.2, 1] }}
            className="h-full overflow-y-auto rounded-3xl bg-white shadow-md ring-1 ring-slate-100"
            style={{ WebkitOverflowScrolling: 'touch' }}
            onScroll={(e) => {
              if ((e.currentTarget as HTMLElement).scrollTop > 24) setScrolled(true)
            }}
          >
            {/* ── Photo header ────────────────────────────────── */}
            <div
              className="relative w-full flex-shrink-0 overflow-hidden"
              style={{ paddingBottom: '144%' }}
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

              {/* Privacy badge */}
              {profile.photoUrl && (
                <div className="absolute top-4 left-4 flex items-center gap-1.5 bg-black/30 backdrop-blur-md rounded-full px-3 py-1.5">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <span className="text-white/90 text-[10px] font-semibold">隱私保護中</span>
                </div>
              )}

              {/* Compat badge */}
              <div className="absolute top-4 right-4 bg-black/30 backdrop-blur-md rounded-full px-3 py-1.5 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                <span className="text-sm font-bold text-white">{profile.compatScore}% 契合</span>
              </div>

              {/* Name / Avatar */}
              <div className="absolute bottom-5 left-5 flex items-end gap-3">
                <div
                  className="w-16 h-16 rounded-2xl flex items-center justify-center text-white font-black text-3xl ring-2 ring-white/30 select-none overflow-hidden"
                  style={{ background: `linear-gradient(160deg, ${profile.gradientFrom}, ${profile.gradientTo})` }}
                >
                  {profile.initials}
                </div>
                <div className="pb-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold text-white">{profile.name}</span>
                    <span className="text-lg text-white/75">{profile.age}</span>
                  </div>
                  <CompanyBadge company={profile.company} />
                </div>
              </div>
            </div>

            {/* ── Info section ────────────────────────────────── */}
            <div className="p-4 space-y-4">
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

              {/* ── Q&A ───────────────────────────────────────── */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-5 h-5 rounded-md bg-slate-900 flex items-center justify-center">
                    <MessageSquare className="w-3 h-3 text-white" />
                  </div>
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">價值觀問答</p>
                </div>

                <div className="space-y-3">
                  {profile.qa.map(({ question, answer }, i) => (
                    <div key={i} className="bg-white rounded-2xl p-4 ring-1 ring-slate-100 shadow-sm">
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1.5">
                        Q{i + 1}
                      </p>
                      <p className="text-sm font-semibold text-slate-800 mb-2 leading-snug">{question}</p>
                      <p className="text-sm text-slate-600 leading-relaxed">{answer}</p>
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

                <div className="flex items-center justify-center gap-8">
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
                  >
                    <Heart className="w-7 h-7 text-white" />
                  </motion.button>

                  {index > 0 && <div className="w-12 h-12" />}
                </div>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>

        {/* ── Scroll hint — disappears once user scrolls ── */}
        <AnimatePresence>
          {!scrolled && (
            <motion.div
              initial={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5 }}
              className="absolute bottom-2 left-4 right-4 rounded-b-3xl pointer-events-none flex flex-col items-center justify-end pb-3"
              style={{ height: 88, background: 'linear-gradient(to bottom, transparent, rgba(255,255,255,0.96) 60%)' }}
            >
              <p className="text-[11px] font-semibold text-slate-400 tracking-wide mb-0.5">往下滑查看並配對</p>
              <motion.div
                animate={{ y: [0, 5, 0] }}
                transition={{ repeat: Infinity, duration: 1.1, ease: 'easeInOut' }}
              >
                <ChevronDown className="w-4 h-4 text-slate-300" />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

// ─── Matches Tab ─────────────────────────────────────────────────────────────

function MatchesTab() {
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
            whileTap={{ scale: 0.98 }}
            className="bg-white rounded-2xl p-4 shadow-sm ring-1 ring-slate-100 flex items-center gap-4 cursor-pointer"
          >
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg flex-shrink-0"
              style={{ background: `linear-gradient(135deg, ${match.from}, ${match.to})` }}
            >
              {match.initials}
            </div>
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
              <p className="text-xs text-slate-500 truncate">{match.lastMessage}</p>
            </div>
            <div className="flex flex-col items-end gap-1 flex-shrink-0">
              <span className="text-[10px] text-slate-400">{match.time}</span>
              {match.unread > 0 && (
                <span className="w-4 h-4 bg-slate-800 text-white rounded-full text-[9px] font-bold flex items-center justify-center">
                  {match.unread}
                </span>
              )}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

// ─── Messages Tab ─────────────────────────────────────────────────────────────

function MessagesTab({
  onChatInputFocus,
  onChatInputBlur,
}: {
  onChatInputFocus?: () => void
  onChatInputBlur?: () => void
}) {
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState([
    { id: 1, text: '你也喜歡手沖嗎？我最近在練習 V60 ☕', from: 'them', time: '14:32' },
    { id: 2, text: '對！最近迷上了衣索比亞豆，果香真的很迷人', from: 'me', time: '14:35' },
    { id: 3, text: '哇，品味很好耶！你在新竹嗎？有一間小店推薦你', from: 'them', time: '14:36' },
  ])
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = () => {
    if (!input.trim()) return
    setMessages((m) => [...m, { id: Date.now(), text: input, from: 'me', time: '剛剛' }])
    setInput('')
    // Keep the keyboard up — prevents iOS from dismissing it briefly,
    // which would cause the nav bar to flash back above the keyboard.
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  return (
    <div className="flex flex-col min-h-full h-full bg-white">
      <div className="flex items-center gap-3 px-4 pt-4 pb-3 border-b border-gray-200 flex-shrink-0">
        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-violet-600 to-purple-600 flex items-center justify-center text-white font-bold text-sm">
          王
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-900">王雅婷</p>
          <p className="text-xs text-slate-400">理律法律事務所 · 律師</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3" style={{ WebkitOverflowScrolling: 'touch' }}>
        {messages.map((msg) => (
          <motion.div
            key={msg.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn('flex', msg.from === 'me' ? 'justify-end' : 'justify-start')}
          >
            <div className={cn(
              'max-w-[72%] px-4 py-2.5 rounded-2xl text-sm',
              msg.from === 'me'
                ? 'bg-slate-800 text-white rounded-br-md'
                : 'bg-white ring-1 ring-slate-100 text-slate-800 rounded-bl-md shadow-sm',
            )}>
              <p>{msg.text}</p>
              <p className={cn('text-[10px] mt-1', msg.from === 'me' ? 'text-slate-400 text-right' : 'text-slate-400')}>
                {msg.time}
              </p>
            </div>
          </motion.div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="px-4 py-3 border-t border-gray-200 bg-white flex items-center gap-3">
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              send()
            }
          }}
          onFocus={(e) => {
            onChatInputFocus?.()
            const el = e.currentTarget
            setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 300)
          }}
          onBlur={() => onChatInputBlur?.()}
          placeholder="說點什麼..."
          style={{ fontSize: '16px' }}
          className="flex-1 bg-white ring-1 ring-slate-200 rounded-full px-4 py-2.5 outline-none focus:ring-slate-400 transition-all"
        />
        <motion.button
          onMouseDown={(e) => e.preventDefault()}
          onClick={send}
          whileTap={{ scale: 0.9 }}
          className="w-9 h-9 bg-slate-800 rounded-full flex items-center justify-center"
        >
          <Send className="w-4 h-4 text-white" />
        </motion.button>
      </div>
    </div>
  )
}

// ─── Profile Tab ──────────────────────────────────────────────────────────────

// ─── Edit Profile (Full Screen) ───────────────────────────────────────────────

interface LocalPhoto {
  id: string
  previewUrl: string
  storagePath?: string  // already uploaded
  file?: File           // new, not yet uploaded
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

    await upsertProfile({
      userId,
      name: name.trim(),
      bio: bio.trim(),
      questionnaire: qa.length > 0 ? qa : undefined,
      photoUrls: uploadedPaths.length > 0 ? uploadedPaths : undefined,
    })

    setSaving(false)
    setSaveMsg('已儲存 ✓')
    setTimeout(() => setSaveMsg(''), 1800)

    const updated: ProfileRow = {
      ...profile,
      name: name.trim(),
      bio: bio.trim(),
      questionnaire: qa.length > 0 ? qa : profile.questionnaire,
      photo_urls: uploadedPaths.length > 0 ? uploadedPaths : profile.photo_urls,
    }
    onSaved(updated)
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 bg-[#fafafa] flex flex-col"
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
    </motion.div>
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

  useEffect(() => {
    getProfile(userId).then(setProfile)
  }, [userId])

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
            <div className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center text-white font-black text-2xl ring-2 ring-white/25">
              {initials}
            </div>
            <div>
              <h2 className="text-lg font-bold text-white leading-tight">{displayName}</h2>
              <p className="text-xs text-white/50 mt-0.5">
                {verStatus === 'approved' ? '✅ 已驗證' : verStatus === 'submitted' ? '審核中' : '待驗證'}
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
          className="w-full flex items-center gap-3 px-4 py-3.5 text-sm text-slate-700 border-b border-slate-50"
        >
          <Bell className="w-4 h-4 text-slate-400" />
          <span>通知設定</span>
        </motion.button>
        <motion.button
          whileTap={{ backgroundColor: '#f8fafc' }}
          className="w-full flex items-center gap-3 px-4 py-3.5 text-sm text-slate-700"
        >
          <Cpu className="w-4 h-4 text-slate-400" />
          <span>公司認證</span>
        </motion.button>
      </div>
      </div>

      {/* Logout — pinned above bottom tab bar, never inside scroll */}
      <div className="flex-shrink-0 px-4 pt-2 pb-1 bg-white border-t border-gray-200">
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
  const [hideTabBarForChatKeyboard, setHideTabBarForChatKeyboard] = useState(false)

  useEffect(() => {
    if (activeTab !== 'messages') setHideTabBarForChatKeyboard(false)
  }, [activeTab])

  // Fetch current user's gender to filter discover profiles
  useEffect(() => {
    if (!user?.id) return
    getProfile(user.id).then((profile) => {
      if (profile?.gender) setCurrentUserGender(profile.gender)
    })
  }, [user?.id])

  const handleSignOut = async () => {
    await signOut()
    onSignOut?.()
  }

  const tabContent: Record<Tab, React.ReactNode> = {
    discover: <DiscoverTab currentUserGender={currentUserGender} />,
    matches: <MatchesTab />,
    messages: (
      <MessagesTab
        onChatInputFocus={() => setHideTabBarForChatKeyboard(true)}
        onChatInputBlur={() => setHideTabBarForChatKeyboard(false)}
      />
    ),
    profile: <ProfileTab userId={user?.id ?? ''} onSignOut={handleSignOut} />,
  }

  const showTabBar = !(activeTab === 'messages' && hideTabBarForChatKeyboard)

  return (
    <div className="max-w-md mx-auto w-full flex flex-col flex-1 min-h-0 h-full bg-white">
      {/* Top bar — flex-none */}
      <div className="flex-none flex items-center px-4 pb-2.5 pt-safe-bar border-b border-gray-200 bg-white">
        <div className="flex items-center gap-1.5 flex-1">
          <div className="w-6 h-6 bg-slate-900 rounded-md flex items-center justify-center">
            <Cpu className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="font-bold text-slate-900 tracking-tight text-sm">tsMedia</span>
          <span className="text-[10px] text-slate-400 ml-1">Silicon Hearts</span>
        </div>
      </div>

      {/* PageContent — flex-1 scroll; tab body not covered by tab bar */}
      <div
        className="flex-1 min-h-0 overflow-y-auto"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            className="min-h-full flex flex-col"
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.18, ease: 'easeInOut' }}
          >
            {tabContent[activeTab]}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* TabBar — flex column sibling only; no fixed/absolute */}
      {showTabBar && (
        <nav
          className="flex-none w-full bg-white border-t border-gray-200"
          style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        >
          <div className="flex items-stretch">
            {NAV_ITEMS.map(({ tab, icon: Icon, label }) => (
              <button
                key={tab}
                type="button"
                onClick={() => { prevTab.current = activeTab; setActiveTab(tab) }}
                className="flex-1 flex flex-col items-center gap-0.5 py-2.5 relative"
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
    </div>
  )
}
