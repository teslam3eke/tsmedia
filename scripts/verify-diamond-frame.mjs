const css = {
  frameLeftPct: 0,
  frameTopPct: 0,
  frameWidthPct: 100,
  frameHeightPct: 100,
  photoInsetLeftPct: 6,
  photoInsetRightPct: 6,
  photoInsetTopPct: 3.35,
  photoInsetBottomPct: 3.5,
}

const photo = {
  width: 390,
  height: 585,
}

const frameBox = {
  left: photo.width * css.frameLeftPct / 100,
  top: photo.height * css.frameTopPct / 100,
  width: photo.width * css.frameWidthPct / 100,
  height: photo.height * css.frameHeightPct / 100,
}

const photoBox = {
  left: photo.width * css.photoInsetLeftPct / 100,
  top: photo.height * css.photoInsetTopPct / 100,
  right: photo.width * (1 - css.photoInsetRightPct / 100),
  bottom: photo.height * (1 - css.photoInsetBottomPct / 100),
}

const frameBoxRight = frameBox.left + frameBox.width
const frameBoxBottom = frameBox.top + frameBox.height

const errors = []

if (frameBox.left < 0) {
  errors.push(`frame extends left outside photo box by ${Math.abs(frameBox.left).toFixed(1)}px`)
}
if (frameBox.top < 0) {
  errors.push(`frame extends above photo box by ${Math.abs(frameBox.top).toFixed(1)}px`)
}
if (frameBoxRight > photo.width) {
  errors.push(`frame extends right outside photo box by ${(frameBoxRight - photo.width).toFixed(1)}px`)
}
if (frameBoxBottom > photo.height) {
  errors.push(`frame extends below photo box by ${(frameBoxBottom - photo.height).toFixed(1)}px`)
}

const measuredFrameOpeningPct = {
  left: 49 / 818 * 100,
  top: 46 / 1415 * 100,
  right: 48 / 818 * 100,
  bottom: 48 / 1415 * 100,
}

if (css.photoInsetLeftPct < measuredFrameOpeningPct.left) {
  errors.push('photo inset left is outside the measured frame opening')
}
if (css.photoInsetRightPct < measuredFrameOpeningPct.right) {
  errors.push('photo inset right is outside the measured frame opening')
}
if (css.photoInsetTopPct < measuredFrameOpeningPct.top) {
  errors.push('photo inset top is outside the measured frame opening')
}
if (css.photoInsetBottomPct < measuredFrameOpeningPct.bottom) {
  errors.push('photo inset bottom is outside the measured frame opening')
}

console.log('Diamond frame verification')
console.log({
  photo,
  css,
  frameBox: {
    left: frameBox.left.toFixed(1),
    top: frameBox.top.toFixed(1),
    right: frameBoxRight.toFixed(1),
    bottom: frameBoxBottom.toFixed(1),
    width: frameBox.width.toFixed(1),
    height: frameBox.height.toFixed(1),
  },
  coverage: {
    photoInsetLeftPx: photoBox.left.toFixed(1),
    photoInsetTopPx: photoBox.top.toFixed(1),
    photoInsetRightPx: (photo.width - photoBox.right).toFixed(1),
    photoInsetBottomPx: (photo.height - photoBox.bottom).toFixed(1),
  },
})

if (errors.length > 0) {
  console.error(errors.join('\n'))
  process.exit(1)
}

console.log('PASS: frame stays inside the card and photo is clipped inside the measured frame opening.')
