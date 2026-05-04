/** 聊天室 4×4 拼圖單格 SVG path（viewBox 400×600，與 PuzzlePhotoUnlock 一致）。 */
export function getPuzzleTilePath(tile: number) {
  const col = tile % 4
  const row = Math.floor(tile / 4)
  const x = col * 100
  const y = row * 150
  const w = 100
  const h = 150
  const cx = x + w / 2
  const cy = y + h / 2
  const rightTab = col < 3
  const bottomTab = row < 3
  const leftTab = col > 0
  const topTab = row > 0

  return [
    `M ${x} ${y}`,
    `L ${cx - 10} ${y}`,
    topTab ? `C ${cx - 5} ${y - 20}, ${cx + 5} ${y - 20}, ${cx + 10} ${y}` : `L ${cx + 10} ${y}`,
    `L ${x + w} ${y}`,
    `L ${x + w} ${cy - 12}`,
    rightTab ? `C ${x + w + 18} ${cy - 6}, ${x + w + 18} ${cy + 6}, ${x + w} ${cy + 12}` : `L ${x + w} ${cy + 12}`,
    `L ${x + w} ${y + h}`,
    `L ${cx + 10} ${y + h}`,
    bottomTab ? `C ${cx + 5} ${y + h + 20}, ${cx - 5} ${y + h + 20}, ${cx - 10} ${y + h}` : `L ${cx - 10} ${y + h}`,
    `L ${x} ${y + h}`,
    `L ${x} ${cy + 12}`,
    leftTab ? `C ${x - 18} ${cy + 6}, ${x - 18} ${cy - 6}, ${x} ${cy - 12}` : `L ${x} ${cy - 12}`,
    'Z',
  ].join(' ')
}
