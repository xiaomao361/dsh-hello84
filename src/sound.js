import { getPrefs } from './prefs.js'

function playTone(win, sequence, force = false) {
  if (!win) return false
  const prefs = getPrefs(win)
  if (!force && prefs.get('sound', false) !== true) return false
  const AudioCtx = win.AudioContext || win.webkitAudioContext
  if (!AudioCtx) return false
  let ctx
  try {
    ctx = new AudioCtx()
    if (ctx.state === 'suspended') Promise.resolve(ctx.resume()).catch(() => {})
    const now = ctx.currentTime
    let maxEnd = 0
    for (const note of sequence) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = note.type || 'square'
      osc.frequency.setValueAtTime(note.freq, now + (note.start || 0))
      if (note.freqEnd) {
        osc.frequency.exponentialRampToValueAtTime(note.freqEnd, now + (note.start || 0) + note.dur)
      }
      const vol = note.vol ?? 0.045
      gain.gain.setValueAtTime(0.0001, now + (note.start || 0))
      gain.gain.linearRampToValueAtTime(vol, now + (note.start || 0) + 0.005)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + (note.start || 0) + note.dur)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now + (note.start || 0))
      osc.stop(now + (note.start || 0) + note.dur + 0.02)
      maxEnd = Math.max(maxEnd, (note.start || 0) + note.dur + 0.05)
    }
    win.setTimeout(() => {
      if (ctx && ctx.state !== 'closed') Promise.resolve(ctx.close()).catch(() => {})
    }, Math.ceil(maxEnd * 1000) + 60)
    return true
  } catch {
    if (ctx && ctx.state !== 'closed') Promise.resolve(ctx.close()).catch(() => {})
    return false
  }
}

export const sound = {
  click(win) {
    return playTone(win, [{ freq: 1800, freqEnd: 900, dur: 0.022, type: 'square', vol: 0.028 }])
  },
  startup(win) {
    // Warm F-major-ish 1984 Mac boot chime
    return playTone(win, [
      { freq: 349.23, dur: 0.55, type: 'triangle', vol: 0.045, start: 0 },
      { freq: 523.25, dur: 0.55, type: 'triangle', vol: 0.04, start: 0.01 },
      { freq: 698.46, dur: 0.52, type: 'sine', vol: 0.035, start: 0.02 },
    ])
  },
  floppy(win) {
    return playTone(win, [
      { freq: 140, freqEnd: 110, dur: 0.045, type: 'sawtooth', vol: 0.03, start: 0 },
      { freq: 175, freqEnd: 130, dur: 0.045, type: 'sawtooth', vol: 0.03, start: 0.065 },
      { freq: 150, freqEnd: 120, dur: 0.05, type: 'sawtooth', vol: 0.025, start: 0.13 },
    ])
  },
  happy(win) {
    return playTone(win, [
      { freq: 587.33, dur: 0.09, type: 'square', vol: 0.035, start: 0 },
      { freq: 880.0, dur: 0.16, type: 'square', vol: 0.04, start: 0.1 },
    ])
  },
  sad(win) {
    return playTone(win, [
      { freq: 240, freqEnd: 180, dur: 0.18, type: 'sawtooth', vol: 0.04, start: 0 },
      { freq: 160, freqEnd: 110, dur: 0.28, type: 'sawtooth', vol: 0.045, start: 0.2 },
    ])
  },
  alarm(win, force = false) {
    return playTone(win, [
      { freq: 1046.5, dur: 0.1, type: 'square', vol: 0.045, start: 0 },
      { freq: 1046.5, dur: 0.1, type: 'square', vol: 0.045, start: 0.14 },
      { freq: 1318.5, dur: 0.18, type: 'square', vol: 0.045, start: 0.28 },
    ], force)
  },
}
