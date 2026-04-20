import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Heart, X, MessageCircle, Compass, User,
  Sparkles, MapPin, Briefcase, GraduationCap,
  ChevronLeft, Send, Bell,
  Cpu, Zap, LogOut, MessageSquare, Check, Pencil,
  Camera, Trash2, ImageIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { signOut } from '@/lib/auth'
import { getProfile, upsertProfile, uploadPhoto } from '@/lib/db'
import type { ProfileRow, QuestionnaireEntry } from '@/lib/types'

// ─── Types ───────────────────────────────────────────────────────────────────

interface QA {
  question: string
  answer: string
}

interface Profile {
  id: number
  name: string
  age: number
  company: 'TSMC' | 'MediaTek'
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
  qa: QA[]
}

type Tab = 'discover' | 'matches' | 'messages' | 'profile'

// ─── Data ─────────────────────────────────────────────────────────────────────

const PROFILES: Profile[] = [
  {
    id: 1,
    name: '林子晴',
    age: 28,
    company: 'TSMC',
    role: '製程整合工程師',
    department: 'N3 製程技術',
    location: '新竹',
    education: '台大電機所',
    bio: '喜歡在無塵室之外尋找生活的美好。週末迷戀咖啡館和獨立書店，偶爾爬山看日出。相信工程師的靈魂也需要詩意。',
    interests: ['精品咖啡', '登山', '底片攝影', '日本文學'],
    initials: '林',
    gradientFrom: '#334155',
    gradientTo: '#475569',
    compatScore: 97,
    qa: [
      { question: '你如何看待金錢和儲蓄的關係？', answer: '我習慣每月把收入的 30% 存起來，但不吝嗇在真正值得的事上花錢——比如一趟精心規劃的旅行，或一台好的相機。錢是工具，不是目的。' },
      { question: '工作佔你生活的比重是多少？你如何找到平衡？', answer: '工作很重要，但我拒絕讓它定義我的全部。下班後我會嚴格斷線，週末盡量不看公事訊息。生活品質對我來說和工作表現一樣重要。' },
      { question: '你夢想中的五年後是什麼樣子？', answer: '技術上繼續成長，但同時希望有更多時間做自己喜歡的事。如果可以，想在山腳下租一間小房子，週末爬山、拍照，平日認真工作。' },
      { question: '你如何處理感情中的衝突？', answer: '直接說出來，不讓情緒累積。我討厭冷戰，更喜歡坐下來好好談，就算當下不舒服，也比沉默更能解決問題。' },
      { question: '什麼樣的人能讓你願意長期相處？', answer: '不一定要興趣相同，但要有自己的想法和堅持。能在深夜聊某個很小眾的話題而不覺得無聊的人，對我來說很珍貴。' },
    ],
  },
  {
    id: 2,
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
    qa: [
      { question: '你如何看待金錢和儲蓄的關係？', answer: '我是「消費要有意義」派。不太買衝動財，但願意為品質付錢。每季會回顧自己的支出，確保花的地方真的讓自己快樂。' },
      { question: '工作佔你生活的比重是多少？你如何找到平衡？', answer: 'Deadline 前會全力衝，但衝過之後一定補回來。上週 tapeout 結束後，我花了整個週末什麼事都不做，只是彈吉他和烤麵包。' },
      { question: '你夢想中的五年後是什麼樣子？', answer: '希望技術上更深，但同時開始思考創業的可能。不一定要大公司，但想做真的有意思的東西，而不只是完成 spec。' },
      { question: '你如何處理感情中的衝突？', answer: '我通常需要一點時間冷靜，再來談。不是逃避，是怕在情緒最高點說出不該說的話。之後一定會好好解釋自己的想法。' },
      { question: '什麼樣的人能讓你願意長期相處？', answer: '有自己生活重心的人。不需要我時時刻刻在，但在一起時很有品質。能聊晶片設計，也能聊為什麼 Coltrane 的即興那麼迷人。' },
    ],
  },
  {
    id: 3,
    name: '吳思妤',
    age: 26,
    company: 'TSMC',
    role: '良率提升工程師',
    department: '先進封裝',
    location: '台南',
    education: '成大材料所',
    bio: '從材料走到半導體，探索一直是我的本能。週末騎單車，偏愛台式小吃和冷門的台灣電影。',
    interests: ['單車', '台式料理', '台灣電影', '植物'],
    initials: '吳',
    gradientFrom: '#064e3b',
    gradientTo: '#065f46',
    compatScore: 91,
    qa: [
      { question: '你如何看待金錢和儲蓄的關係？', answer: '我不太焦慮錢，但也不亂花。有穩定的緊急備用金，剩下的我會拿來買有價值的體驗，像是一趟認識台灣的單車旅行。' },
      { question: '工作佔你生活的比重是多少？你如何找到平衡？', answer: '台南廠的步調讓我還算平衡。下班後我會去菜市場買食材自己煮，或者去社區植物園澆水。這些小事讓我充電。' },
      { question: '你夢想中的五年後是什麼樣子？', answer: '希望技術夠深，但也想慢慢往管理走。最重要的是，還住在一個讓我喜歡的城市，不一定要台北，或許就台南。' },
      { question: '你如何處理感情中的衝突？', answer: '我喜歡趁熱處理。冷掉之後反而更難開口，所以我通常會主動說「我覺得剛才那件事讓我不太舒服，我們聊一下好嗎？」' },
      { question: '什麼樣的人能讓你願意長期相處？', answer: '接地氣、不裝的人。能帶我去沒去過的小吃攤，也能陪我在大熱天騎車找一間鮮少人知道的廟埕咖啡的那種人。' },
    ],
  },
  {
    id: 4,
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
    qa: [
      { question: '你如何看待金錢和儲蓄的關係？', answer: '我把財務當成一個需要長期 optimize 的系統。固定投入指數基金，生活開銷有預算，但不讓自己活得太侷促。' },
      { question: '工作佔你生活的比重是多少？你如何找到平衡？', answer: '我現在大概 6:4。工作仍然佔大頭，但我在有意識地調整。最近開始每週五下班後不碰電腦，成效不錯。' },
      { question: '你夢想中的五年後是什麼樣子？', answer: '想做出一個真正改變人們生活方式的 AI 產品。不一定要自己創業，但要在一個讓我覺得「這件事值得做」的地方。' },
      { question: '你如何處理感情中的衝突？', answer: '我會先想清楚自己到底在不舒服什麼，再去談。有時候我以為是對方的問題，想清楚後發現是自己的預期設太高了。' },
      { question: '什麼樣的人能讓你願意長期相處？', answer: '有好奇心、能被說服也能說服我的人。我不太在乎對方背景，但希望有一種「跟你聊天我會變得更好」的感覺。' },
    ],
  },
  {
    id: 5,
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
    qa: [
      { question: '你如何看待金錢和儲蓄的關係？', answer: '我對錢的態度比較隨意——存一定比例，剩下的就用在讓生活更有意思的地方，比如天文設備或去暗天保護區的旅費。' },
      { question: '工作佔你生活的比重是多少？你如何找到平衡？', answer: 'EUV 的排班讓我沒什麼規律，但夜空是我最好的解藥。只要能在山上待上一個晚上，下週又可以全力衝。' },
      { question: '你夢想中的五年後是什麼樣子？', answer: '希望能去智利阿塔卡馬沙漠待一個月，然後回來繼續工作。人生不用全部搞懂，但要有幾件真的很想做的事。' },
      { question: '你如何處理感情中的衝突？', answer: '我不擅長當下表達情緒，通常需要一段時間沉澱。但我很在乎「不讓問題懸著」，一定會找機會說清楚。' },
      { question: '什麼樣的人能讓你願意長期相處？', answer: '能在深夜一起躺在野外睡袋裡看銀河、什麼都不說的人。也或者願意讓我跟他們說那條銀河有多壯闊的人。' },
    ],
  },
]

const MATCHES = [
  { id: 101, name: '王雅婷', company: 'MediaTek', role: '射頻工程師', initials: '王', lastMessage: '你也喜歡手沖嗎？我最近在練習 V60 ☕', time: '剛剛', unread: 2, from: '#7c3aed', to: '#6d28d9' },
  { id: 102, name: '劉承恩', company: 'TSMC', role: '製程研發工程師', initials: '劉', lastMessage: '週末要一起去陽明山嗎？', time: '14 分鐘', unread: 0, from: '#0f766e', to: '#0d9488' },
  { id: 103, name: '蔡佩如', company: 'MediaTek', role: '數位設計工程師', initials: '蔡', lastMessage: '那部紀錄片我也很想看！', time: '1 小時', unread: 1, from: '#b45309', to: '#d97706' },
]

// ─── Utility ─────────────────────────────────────────────────────────────────

function CompanyBadge({ company }: { company: 'TSMC' | 'MediaTek' }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide uppercase',
      company === 'TSMC'
        ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200'
        : 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200',
    )}>
      <Cpu className="w-2.5 h-2.5" />
      {company}
    </span>
  )
}

// ─── Discover Tab ─────────────────────────────────────────────────────────────

function DiscoverTab() {
  const [index, setIndex] = useState(0)
  const [direction, setDirection] = useState<'next' | 'prev'>('next')
  const [done, setDone] = useState(false)

  const profile = PROFILES[index]

  const goNext = () => {
    if (index >= PROFILES.length - 1) { setDone(true); return }
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
          <p className="text-xs text-slate-400 mt-0.5">{index + 1} / {PROFILES.length}</p>
        </div>
        <button className="w-9 h-9 rounded-full bg-white ring-1 ring-slate-100 shadow-sm flex items-center justify-center relative">
          <Bell className="w-4 h-4 text-slate-500" />
          <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-red-400 rounded-full" />
        </button>
      </div>

      {/* Card */}
      <div className="flex-1 overflow-hidden px-4 pb-2">
        <AnimatePresence mode="wait">
          <motion.div
            key={profile.id}
            initial={{ opacity: 0, x: direction === 'next' ? 60 : -60 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: direction === 'next' ? -60 : 60 }}
            transition={{ duration: 0.26, ease: [0.4, 0, 0.2, 1] }}
            className="h-full overflow-y-auto rounded-3xl bg-white shadow-md ring-1 ring-slate-100"
            style={{ WebkitOverflowScrolling: 'touch' }}
          >
            {/* ── Gradient photo header ───────────────────────── */}
            <div
              className="relative w-full flex-shrink-0"
              style={{
                background: `linear-gradient(160deg, ${profile.gradientFrom}, ${profile.gradientTo})`,
                paddingBottom: '144%',
              }}
            >
              {/* Noise overlay */}
              <div className="absolute inset-0 opacity-20"
                style={{
                  backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.25) 1px, transparent 0)',
                  backgroundSize: '18px 18px',
                }}
              />

              {/* Compat badge */}
              <div className="absolute top-4 right-4 bg-black/30 backdrop-blur-md rounded-full px-3 py-1.5 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                <span className="text-sm font-bold text-white">{profile.compatScore}% 契合</span>
              </div>

              {/* Avatar */}
              <div className="absolute bottom-5 left-5 flex items-end gap-3">
                <div className="w-16 h-16 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center text-white font-black text-3xl ring-2 ring-white/30 select-none">
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

function MessagesTab() {
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState([
    { id: 1, text: '你也喜歡手沖嗎？我最近在練習 V60 ☕', from: 'them', time: '14:32' },
    { id: 2, text: '對！最近迷上了衣索比亞豆，果香真的很迷人', from: 'me', time: '14:35' },
    { id: 3, text: '哇，品味很好耶！你在新竹嗎？有一間小店推薦你', from: 'them', time: '14:36' },
  ])

  const send = () => {
    if (!input.trim()) return
    setMessages((m) => [...m, { id: Date.now(), text: input, from: 'me', time: '剛剛' }])
    setInput('')
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 pt-4 pb-3 border-b border-slate-100">
        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-violet-600 to-purple-600 flex items-center justify-center text-white font-bold text-sm">
          王
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-900">王雅婷</p>
          <p className="text-xs text-slate-400">MediaTek · 射頻工程師</p>
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
      </div>

      <div className="px-4 py-3 border-t border-slate-100 bg-[#fafafa] flex items-center gap-3 safe-bottom">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          onFocus={(e) => { const el = e.currentTarget; setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 300) }}
          placeholder="說點什麼..."
          className="flex-1 bg-white ring-1 ring-slate-200 rounded-full px-4 py-2.5 text-sm outline-none focus:ring-slate-400 transition-all"
        />
        <motion.button
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
      <div className="flex-shrink-0 flex items-center justify-between px-5 pt-12 pb-3 bg-[#fafafa] border-b border-slate-100">
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
                <img src={photo.previewUrl} alt="" className="w-full h-full object-cover" />
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

  useEffect(() => {
    getProfile(userId).then(setProfile)
  }, [userId])

  const displayName = profile?.name ?? '—'
  const initials = displayName !== '—' ? displayName.charAt(0) : '?'
  const interests = profile?.interests ?? []
  const bio = profile?.bio ?? ''
  const verStatus = profile?.verification_status ?? 'pending'

  return (
    <div className="flex flex-col h-full overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
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

      {/* Actions */}
      <div className="mx-4 mt-3 mb-6 bg-white rounded-2xl shadow-sm ring-1 ring-slate-100 overflow-hidden">
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
          className="w-full flex items-center gap-3 px-4 py-3.5 text-sm text-slate-700 border-b border-slate-50"
        >
          <Cpu className="w-4 h-4 text-slate-400" />
          <span>公司認證</span>
        </motion.button>
        <motion.button
          whileTap={{ backgroundColor: '#fff1f2' }}
          onClick={onSignOut}
          className="w-full flex items-center gap-3 px-4 py-3.5 text-sm text-red-500"
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

  const handleSignOut = async () => {
    await signOut()
    onSignOut?.()
  }

  const tabContent: Record<Tab, React.ReactNode> = {
    discover: <DiscoverTab />,
    matches: <MatchesTab />,
    messages: <MessagesTab />,
    profile: <ProfileTab userId={user?.id ?? ''} onSignOut={handleSignOut} />,
  }

  return (
    <div className="min-h-dvh max-w-md mx-auto flex flex-col bg-[#fafafa] relative">
      {/* Brand bar */}
      <div className="flex items-center px-4 py-2.5 border-b border-slate-100/80">
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={handleSignOut}
          className="w-9 h-9 rounded-full bg-white ring-1 ring-slate-100 shadow-sm flex items-center justify-center mr-3"
        >
          <ChevronLeft className="w-5 h-5 text-slate-600" />
        </motion.button>
        <div className="flex items-center gap-1.5 flex-1">
          <div className="w-6 h-6 bg-slate-900 rounded-md flex items-center justify-center">
            <Cpu className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="font-bold text-slate-900 tracking-tight text-sm">tsMedia</span>
          <span className="text-[10px] text-slate-400 ml-1">Silicon Hearts</span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 relative overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            className="absolute inset-0 flex flex-col"
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.18, ease: 'easeInOut' }}
          >
            {tabContent[activeTab]}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Bottom nav */}
      <nav className="border-t border-slate-100 bg-[#fafafa]/95 backdrop-blur-sm safe-bottom">
        <div className="flex items-stretch">
          {NAV_ITEMS.map(({ tab, icon: Icon, label }) => (
            <button
              key={tab}
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
    </div>
  )
}
