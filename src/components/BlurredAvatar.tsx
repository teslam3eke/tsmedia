import { Lock } from 'lucide-react'
import { motion } from 'framer-motion'

interface Props {
  gradientFrom: string
  gradientTo: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const SIZE_MAP = {
  sm: { outer: 'w-12 h-12', blur: 'w-12 h-12', text: 'text-[8px]', icon: 10 },
  md: { outer: 'w-16 h-16', blur: 'w-16 h-16', text: 'text-[9px]', icon: 12 },
  lg: { outer: 'w-20 h-20', blur: 'w-20 h-20', text: 'text-[10px]', icon: 14 },
}

export default function BlurredAvatar({
  gradientFrom,
  gradientTo,
  size = 'md',
  className = '',
}: Props) {
  const s = SIZE_MAP[size]

  return (
    <div className={`relative rounded-full overflow-hidden flex-shrink-0 ${s.outer} ${className}`}>
      {/* Blurred gradient base — 45px blur for strong privacy effect */}
      <div
        className={`absolute inset-0 rounded-full ${s.blur}`}
        style={{
          background: `radial-gradient(circle at 35% 35%, ${gradientFrom}, ${gradientTo})`,
          filter: 'blur(45px)',
          transform: 'scale(1.4)',
        }}
      />
      {/* Inner shape to fill */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: `linear-gradient(135deg, ${gradientFrom}cc, ${gradientTo}cc)`,
        }}
      />

      {/* Overlay: 隱私保護中 */}
      <motion.div
        className="absolute inset-0 flex flex-col items-center justify-center rounded-full"
        style={{ background: 'rgba(0,0,0,0.42)', backdropFilter: 'blur(6px)' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
      >
        <Lock size={s.icon} className="text-white/90 mb-0.5" />
        <span className={`text-white/80 font-semibold leading-tight tracking-tight ${s.text}`}>
          隱私保護中
        </span>
      </motion.div>
    </div>
  )
}
