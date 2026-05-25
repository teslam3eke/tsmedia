export function hashFromUuid(uuid: string): number {
  let h = 0
  for (let i = 0; i < uuid.length; i++) h = Math.imul(31, h) + uuid.charCodeAt(i) | 0
  return Math.abs(h)
}

export function uuidToGradients(uuid: string): { from: string; to: string } {
  const h = hashFromUuid(uuid)
  return {
    from: `hsl(${h % 360} 62% 42%)`,
    to: `hsl(${(h + 42) % 360} 58% 36%)`,
  }
}
