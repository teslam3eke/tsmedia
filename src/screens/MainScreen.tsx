import { useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Heart, X, MessageCircle, Compass, User,
  Sparkles, MapPin, Briefcase, GraduationCap,
  ChevronLeft, Send, Bell,
  Cpu, Zap, BookOpen, Coffee, Search, LogOut,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { signOut } from '@/lib/auth'

// ─── Types ───────────────────────────────────────────────────────────────────

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
  },
  {
    id: 6,
    name: '黃盈潔',
    age: 27,
    company: 'MediaTek',
    role: '射頻 IC 設計',
    department: '無線通訊研發',
    location: '新竹',
    education: '台大電信所',
    bio: '在頻率與訊號之間找靈感。空閒時嘗試烘焙、游泳，還有看一些沒有人看過的冷門電影。',
    interests: ['烘焙', '游泳', '電影', '清酒'],
    initials: '黃',
    gradientFrom: '#92400e',
    gradientTo: '#b45309',
    compatScore: 86,
  },
]

const MATCHES = [
  { id: 101, name: '王雅婷', company: 'MediaTek', role: '射頻工程師', initials: '王', lastMessage: '你也喜歡手沖嗎？我最近在練習 V60 ☕', time: '剛剛', unread: 2, from: '#7c3aed', to: '#6d28d9' },
  { id: 102, name: '劉承恩', company: 'TSMC', role: '製程研發工程師', initials: '劉', lastMessage: '週末要一起去陽明山嗎？', time: '14 分鐘', unread: 0, from: '#0f766e', to: '#0d9488' },
  { id: 103, name: '蔡佩如', company: 'MediaTek', role: '數位設計工程師', initials: '蔡', lastMessage: '那部紀錄片我也很想看！', time: '1 小時', unread: 1, from: '#b45309', to: '#d97706' },
]

// ─── Utility Components ───────────────────────────────────────────────────────

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

function CompatBar({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-2">
      <Zap className="w-3 h-3 text-amber-400" />
      <div className="flex-1 h-1 bg-slate-100 rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-gradient-to-r from-slate-600 to-slate-400 rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${score}%` }}
          transition={{ duration: 0.8, ease: 'easeOut', delay: 0.2 }}
        />
      </div>
      <span className="text-xs font-semibold text-slate-500">{score}%</span>
    </div>
  )
}

// ─── Pinterest Profile Card ───────────────────────────────────────────────────

function ProfileCard({
  profile,
  onTap,
  delay = 0,
}: {
  profile: Profile
  onTap: () => void
  delay?: number
}) {
  return (
    <motion.div
      onClick={onTap}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut', delay }}
      whileTap={{ scale: 0.97 }}
      className="rounded-3xl overflow-hidden bg-white shadow-sm ring-1 ring-slate-100/80 cursor-pointer"
    >
      {/* Gradient header */}
      <div
        className="relative"
        style={{
          background: `linear-gradient(145deg, ${profile.gradientFrom}, ${profile.gradientTo})`,
          paddingTop: '70%',
        }}
      >
        {/* Compat badge */}
        <div className="absolute top-2.5 right-2.5 bg-black/30 backdrop-blur-md rounded-full px-2 py-0.5 flex items-center gap-1">
          <Sparkles className="w-2.5 h-2.5 text-amber-300" />
          <span className="text-[11px] font-bold text-white">{profile.compatScore}%</span>
        </div>

        {/* Avatar */}
        <div className="absolute bottom-3 left-3 w-11 h-11 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center text-white font-bold text-xl ring-2 ring-white/30">
          {profile.initials}
        </div>

        {/* Company */}
        <div className="absolute bottom-3 right-3">
          <span className={cn(
            'text-[9px] font-bold px-1.5 py-0.5 rounded-full tracking-wide',
            profile.company === 'TSMC'
              ? 'bg-blue-500/80 text-white'
              : 'bg-indigo-500/80 text-white',
          )}>
            {profile.company}
          </span>
        </div>
      </div>

      {/* Info */}
      <div className="p-3 pb-3.5">
        <div className="flex items-baseline gap-1.5 mb-0.5">
          <span className="font-bold text-[13px] text-slate-900 leading-tight">{profile.name}</span>
          <span className="text-xs text-slate-400">{profile.age}</span>
        </div>
        <p className="text-[11px] text-slate-500 font-medium mb-1.5 leading-tight">{profile.role}</p>
        <p className="text-[11px] text-slate-400 leading-snug line-clamp-2 mb-2">{profile.bio}</p>
        <div className="flex flex-wrap gap-1">
          {profile.interests.slice(0, 2).map((tag) => (
            <span
              key={tag}
              className="px-2 py-0.5 bg-slate-50 ring-1 ring-slate-200 rounded-full text-[10px] font-medium text-slate-500"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>
    </motion.div>
  )
}

// ─── Profile Detail Drawer ─────────────────────────────────────────────────────

function ProfileDrawer({ profile, onClose, onLike, onPass }: {
  profile: Profile
  onClose: () => void
  onLike: () => void
  onPass: () => void
}) {
  return (
    <motion.div
      className="fixed inset-0 z-50 flex flex-col"
      initial={{ y: '100%' }}
      animate={{ y: 0 }}
      exit={{ y: '100%' }}
      transition={{ type: 'spring', stiffness: 300, damping: 35 }}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <div className="relative mt-auto bg-[#fafafa] rounded-t-3xl overflow-hidden max-h-[92dvh] flex flex-col">
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 bg-slate-200 rounded-full" />
        </div>

        <div className="mx-4 mb-4 rounded-2xl overflow-hidden h-52 relative flex-shrink-0"
          style={{ background: `linear-gradient(160deg, ${profile.gradientFrom}, ${profile.gradientTo})` }}
        >
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
          <div className="absolute bottom-4 left-4 right-4">
            <div className="flex items-end justify-between">
              <div>
                <div className="flex items-baseline gap-2">
                  <h2 className="text-2xl font-bold text-white">{profile.name}</h2>
                  <span className="text-lg text-white/80">{profile.age}</span>
                </div>
                <CompanyBadge company={profile.company} />
              </div>
              <div className="bg-white/20 backdrop-blur-md rounded-xl px-3 py-1.5 flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                <span className="text-sm font-bold text-white">{profile.compatScore}%</span>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="absolute top-3 right-3 w-9 h-9 bg-black/30 backdrop-blur-sm rounded-full flex items-center justify-center"
          >
            <ChevronLeft className="w-5 h-5 text-white rotate-90" />
          </button>
        </div>

        <div className="overflow-y-auto px-4 pb-6 flex-1 -webkit-overflow-scrolling-touch">
          <div className="grid grid-cols-3 gap-3 mb-5">
            {[
              { icon: Briefcase, label: profile.role },
              { icon: MapPin, label: profile.location },
              { icon: GraduationCap, label: profile.education },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="bg-white rounded-2xl p-3 text-center shadow-sm ring-1 ring-slate-100">
                <Icon className="w-4 h-4 text-slate-400 mx-auto mb-1" />
                <p className="text-[11px] text-slate-600 font-medium leading-tight">{label}</p>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-2xl p-4 mb-3 shadow-sm ring-1 ring-slate-100">
            <div className="flex items-center gap-2 mb-1">
              <Cpu className="w-3.5 h-3.5 text-slate-400" />
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">部門</p>
            </div>
            <p className="text-sm text-slate-800 font-medium">{profile.department}</p>
          </div>

          <div className="bg-white rounded-2xl p-4 mb-3 shadow-sm ring-1 ring-slate-100">
            <div className="flex items-center gap-2 mb-2">
              <BookOpen className="w-3.5 h-3.5 text-slate-400" />
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">關於我</p>
            </div>
            <p className="text-sm text-slate-700 leading-relaxed">{profile.bio}</p>
          </div>

          <div className="bg-white rounded-2xl p-4 mb-3 shadow-sm ring-1 ring-slate-100">
            <div className="flex items-center gap-2 mb-3">
              <Coffee className="w-3.5 h-3.5 text-slate-400" />
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">興趣</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {profile.interests.map((tag) => (
                <span key={tag} className="px-3 py-1.5 bg-slate-50 ring-1 ring-slate-200 rounded-full text-xs font-medium text-slate-700">
                  {tag}
                </span>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-2xl p-4 shadow-sm ring-1 ring-slate-100">
            <div className="flex items-center gap-2 mb-3">
              <Zap className="w-3.5 h-3.5 text-slate-400" />
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">契合度</p>
            </div>
            <CompatBar score={profile.compatScore} />
          </div>
        </div>

        <div className="flex justify-center gap-6 px-6 py-4 border-t border-slate-100 bg-[#fafafa] safe-bottom">
          <motion.button
            whileTap={{ scale: 0.88 }}
            onClick={onPass}
            className="w-16 h-16 rounded-full border-2 border-slate-200 bg-white flex items-center justify-center shadow-sm hover:border-red-300 hover:text-red-400 transition-colors"
          >
            <X className="w-7 h-7 text-slate-400" />
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.88 }}
            onClick={onLike}
            className="w-16 h-16 rounded-full border-2 border-slate-200 bg-white flex items-center justify-center shadow-sm hover:border-emerald-300 hover:text-emerald-500 transition-colors"
          >
            <Heart className="w-7 h-7 text-slate-400" />
          </motion.button>
        </div>
      </div>
    </motion.div>
  )
}

// ─── Discover Tab — Pinterest Masonry ─────────────────────────────────────────

function DiscoverTab() {
  const [profiles, setProfiles] = useState<Profile[]>(PROFILES)
  const [selected, setSelected] = useState<Profile | null>(null)
  const [liked, setLiked] = useState<Set<number>>(new Set())

  const handleLike = (p: Profile) => {
    setLiked((prev) => new Set([...prev, p.id]))
    setSelected(null)
    setProfiles((prev) => prev.filter((x) => x.id !== p.id))
  }

  const handlePass = (p: Profile) => {
    setSelected(null)
    setProfiles((prev) => prev.filter((x) => x.id !== p.id))
  }

  // 2-column masonry: alternate left/right
  const leftCol = profiles.filter((_, i) => i % 2 === 0)
  const rightCol = profiles.filter((_, i) => i % 2 === 1)

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 pt-3 pb-2 flex-shrink-0">
        <div className="flex items-center justify-between mb-2.5">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900 tracking-tight leading-none">探索</h1>
            <p className="text-xs text-slate-400 mt-0.5">為你推薦的菁英</p>
          </div>
          <button className="w-9 h-9 rounded-full bg-white ring-1 ring-slate-100 shadow-sm flex items-center justify-center relative">
            <Bell className="w-4 h-4 text-slate-500" />
            <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-red-400 rounded-full" />
          </button>
        </div>

        {/* Search bar */}
        <div className="bg-white ring-1 ring-slate-100 rounded-2xl px-3.5 py-2.5 flex items-center gap-2 shadow-sm">
          <Search className="w-3.5 h-3.5 text-slate-300 flex-shrink-0" />
          <span className="text-sm text-slate-300">搜尋工程師、職稱⋯</span>
        </div>
      </div>

      {/* Masonry grid */}
      <div className="flex-1 overflow-y-auto px-3 pt-1 pb-4" style={{ WebkitOverflowScrolling: 'touch' }}>
        {profiles.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center justify-center h-full text-center pt-20"
          >
            <div className="w-20 h-20 rounded-full bg-slate-100 flex items-center justify-center mb-4">
              <Sparkles className="w-9 h-9 text-slate-300" />
            </div>
            <p className="text-slate-700 font-semibold text-lg">今日推薦已全部看完</p>
            <p className="text-slate-400 text-sm mt-1">明天再來探索更多工程師</p>
          </motion.div>
        ) : (
          <div className="flex gap-3">
            {/* Left column */}
            <div className="flex-1 flex flex-col gap-3">
              {leftCol.map((p, i) => (
                <ProfileCard
                  key={p.id}
                  profile={p}
                  delay={i * 0.06}
                  onTap={() => setSelected(p)}
                />
              ))}
            </div>
            {/* Right column — offset for Pinterest stagger effect */}
            <div className="flex-1 flex flex-col gap-3 mt-5">
              {rightCol.map((p, i) => (
                <ProfileCard
                  key={p.id}
                  profile={p}
                  delay={i * 0.06 + 0.04}
                  onTap={() => setSelected(p)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Liked toast */}
      <AnimatePresence>
        {liked.size > 0 && (
          <motion.div
            key="liked-count"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="absolute bottom-20 left-1/2 -translate-x-1/2 bg-emerald-500 text-white text-xs font-semibold px-4 py-2 rounded-full shadow-lg z-10"
          >
            ❤️ 已送出 {liked.size} 個喜歡
          </motion.div>
        )}
      </AnimatePresence>

      {/* Profile Detail Drawer */}
      <AnimatePresence>
        {selected && (
          <ProfileDrawer
            profile={selected}
            onClose={() => setSelected(null)}
            onLike={() => handleLike(selected)}
            onPass={() => handlePass(selected)}
          />
        )}
      </AnimatePresence>
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
                  match.company === 'TSMC'
                    ? 'bg-blue-50 text-blue-600'
                    : 'bg-indigo-50 text-indigo-600',
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
              <p className={cn(
                'text-[10px] mt-1',
                msg.from === 'me' ? 'text-slate-400 text-right' : 'text-slate-400',
              )}>
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

function ProfileTab({ onSignOut }: { onSignOut: () => void }) {
  const stats = [
    { label: '被喜歡', value: '142' },
    { label: '已配對', value: '23' },
    { label: '對話中', value: '8' },
  ]
  const badges = ['台大電機所', '3 年經驗', '新竹', 'TSMC N3']

  return (
    <div className="flex flex-col h-full overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
      <div className="mx-4 mt-4 rounded-3xl overflow-hidden relative h-44"
        style={{ background: 'linear-gradient(160deg, #1e293b, #334155)' }}
      >
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
        <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between">
          <div>
            <h2 className="text-xl font-bold text-white">我的個人檔案</h2>
            <p className="text-xs text-white/60">上次更新 2 天前</p>
          </div>
          <div className="bg-white/20 backdrop-blur-md rounded-xl px-2.5 py-1 flex items-center gap-1">
            <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
            <span className="text-xs text-white font-medium">活躍中</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mx-4 mt-3">
        {stats.map(({ label, value }) => (
          <div key={label} className="bg-white rounded-2xl p-3.5 text-center shadow-sm ring-1 ring-slate-100">
            <p className="text-xl font-bold text-slate-900">{value}</p>
            <p className="text-xs text-slate-400 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      <div className="mx-4 mt-3 bg-white rounded-2xl p-4 shadow-sm ring-1 ring-slate-100">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">身份標籤</p>
          <CompanyBadge company="TSMC" />
        </div>
        <div className="flex flex-wrap gap-2">
          {badges.map((b) => (
            <span key={b} className="px-3 py-1 bg-slate-50 ring-1 ring-slate-200 rounded-full text-xs text-slate-700 font-medium">
              {b}
            </span>
          ))}
        </div>
      </div>

      <div className="mx-4 mt-3 mb-6 bg-white rounded-2xl shadow-sm ring-1 ring-slate-100 overflow-hidden">
        {[
          { icon: User, label: '編輯個人資訊' },
          { icon: Heart, label: '配對偏好設定' },
          { icon: Bell, label: '通知設定' },
          { icon: Cpu, label: '公司認證' },
        ].map(({ icon: Icon, label }, i, arr) => (
          <motion.button
            key={label}
            whileTap={{ backgroundColor: '#f8fafc' }}
            className={cn(
              'w-full flex items-center gap-3 px-4 py-3.5 text-sm text-slate-700',
              i !== arr.length - 1 && 'border-b border-slate-50',
            )}
          >
            <Icon className="w-4 h-4 text-slate-400" />
            <span>{label}</span>
          </motion.button>
        ))}

        {/* Sign out */}
        <motion.button
          whileTap={{ backgroundColor: '#fff1f2' }}
          onClick={onSignOut}
          className="w-full flex items-center gap-3 px-4 py-3.5 text-sm text-red-500 border-t border-slate-50"
        >
          <LogOut className="w-4 h-4" />
          <span>登出</span>
        </motion.button>
      </div>
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

// ─── Root App ─────────────────────────────────────────────────────────────────

export default function MainScreen({ onSignOut }: { user?: import('@supabase/supabase-js').User | null; onSignOut?: () => void }) {
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
    profile: <ProfileTab onSignOut={handleSignOut} />,
  }

  const handleTabChange = (tab: Tab) => {
    prevTab.current = activeTab
    setActiveTab(tab)
  }

  return (
    <div className="min-h-dvh max-w-md mx-auto flex flex-col bg-[#fafafa] relative">
      {/* Brand bar — with back button on the left */}
      <div className="flex items-center px-4 py-2.5 border-b border-slate-100/80">
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={handleSignOut}
          className="w-9 h-9 rounded-full bg-white ring-1 ring-slate-100 shadow-sm flex items-center justify-center mr-3"
          title="返回"
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

      {/* Main content */}
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
              onClick={() => handleTabChange(tab)}
              className="flex-1 flex flex-col items-center gap-0.5 py-2.5 relative"
            >
              {activeTab === tab && (
                <motion.div
                  layoutId="nav-indicator"
                  className="absolute top-0 left-1/4 right-1/4 h-0.5 bg-slate-800 rounded-full"
                  transition={{ type: 'spring', stiffness: 400, damping: 35 }}
                />
              )}
              <Icon className={cn(
                'w-5 h-5 transition-colors',
                activeTab === tab ? 'text-slate-900' : 'text-slate-400',
              )} />
              <span className={cn(
                'text-[10px] font-medium transition-colors',
                activeTab === tab ? 'text-slate-900' : 'text-slate-400',
              )}>
                {label}
              </span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  )
}
