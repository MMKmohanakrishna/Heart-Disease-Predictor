'use strict'

/* ==========================================================
   Config
   ========================================================== */
// Backend base URL. Override without editing code via  ?api=http://host:port
const API_BASE = (() => {
  try {
    const q = new URLSearchParams(location.search).get('api')
    if (q) return q.replace(/\/+$/, '')
  } catch (_) {}
  return 'http://127.0.0.1:8000'
})()

const REQUIRED_COLUMNS = ['Age', 'Sex', 'ChestPainType', 'RestingBP', 'Cholesterol', 'FastingBS',
  'RestingECG', 'MaxHR', 'ExerciseAngina', 'Oldpeak', 'ST_Slope', 'HeartDisease']
const NUMERIC_FIELDS = ['Age', 'RestingBP', 'Cholesterol', 'FastingBS', 'MaxHR', 'Oldpeak']
const FEATURE_LABELS = {
  Age: 'Age', Sex: 'Sex', ChestPainType: 'Chest pain type', RestingBP: 'Resting BP',
  Cholesterol: 'Cholesterol', FastingBS: 'Fasting blood sugar', RestingECG: 'Resting ECG',
  MaxHR: 'Max heart rate', ExerciseAngina: 'Exercise angina', Oldpeak: 'ST depression', ST_Slope: 'ST slope',
}
const SAMPLES = {
  low: { Age: 38, Sex: 'F', ChestPainType: 'ATA', RestingBP: 118, Cholesterol: 190, FastingBS: '0',
    RestingECG: 'Normal', MaxHR: 172, ExerciseAngina: 'N', Oldpeak: 0, ST_Slope: 'Up' },
  high: { Age: 63, Sex: 'M', ChestPainType: 'ASY', RestingBP: 150, Cholesterol: 268, FastingBS: '1',
    RestingECG: 'ST', MaxHR: 105, ExerciseAngina: 'Y', Oldpeak: 2.5, ST_Slope: 'Flat' },
}

const $ = (sel, root = document) => root.querySelector(sel)
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel))
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ==========================================================
   Helpers
   ========================================================== */
function animateNumber(el, to, { from = 0, duration = 1200, format = (v) => Math.round(v) } = {}) {
  if (reduceMotion || duration <= 0) { el.textContent = format(to); return }
  const start = performance.now()
  const ease = (t) => 1 - Math.pow(1 - t, 4)
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration)
    el.textContent = format(from + (to - from) * ease(t))
    if (t < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

function toast(message, type = 'info', ms = 4200) {
  const host = $('#toasts')
  const el = document.createElement('div')
  el.className = 'toast ' + type
  el.setAttribute('role', type === 'error' ? 'alert' : 'status')
  const icon = { success: '✓', error: '✕', warn: '!', info: 'i' }[type] || 'i'
  el.innerHTML = `<b aria-hidden="true">${icon}</b><span></span>`
  el.lastChild.textContent = message // textContent: never inject server text as HTML
  host.appendChild(el)
  const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 350) }
  setTimeout(close, ms)
  el.addEventListener('click', close)
}

// Turn a FastAPI error body (string, {missing:[]}, or 422 list) into readable text.
function errorText(body, fallback) {
  const d = body && body.detail !== undefined ? body.detail : body
  if (typeof d === 'string') return d
  if (Array.isArray(d)) {
    return d.map((e) => {
      const field = Array.isArray(e.loc) ? e.loc.filter((p) => p !== 'body').join('.') : ''
      return (field ? field + ': ' : '') + (e.msg || 'invalid value')
    }).join('; ')
  }
  if (d && Array.isArray(d.missing)) return 'Missing fields: ' + d.missing.join(', ')
  return fallback
}

async function api(path, options = {}, timeoutMs = 60000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  let res
  try {
    res = await fetch(API_BASE + path, { ...options, signal: ctrl.signal })
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('The request timed out. Please try again.')
    const e = new Error(`Cannot reach the backend at ${API_BASE}. Start it with start.ps1 (or uvicorn) and try again.`)
    e.offline = true
    throw e
  } finally {
    clearTimeout(timer)
  }
  let body = null
  try { body = await res.json() } catch (_) {}
  if (!res.ok) throw new Error(errorText(body, `Request failed (${res.status})`))
  return body
}

function setLoading(btn, loading, label) {
  btn.disabled = loading
  btn.classList.toggle('loading', loading)
  if (label) $('.btn-label', btn).textContent = label
}

/* ==========================================================
   Page effects: theme, nav, reveal, spotlight, ripple
   ========================================================== */
function initTheme() {
  $('#themeToggle').addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'
    document.documentElement.setAttribute('data-theme', next)
    try { localStorage.setItem('theme', next) } catch (_) {}
  })
}

function initScrollEffects() {
  const nav = $('#nav')
  const bar = $('#scrollProgress')
  let ticking = false
  const update = () => {
    const y = window.scrollY
    nav.classList.toggle('scrolled', y > 24)
    const max = document.documentElement.scrollHeight - innerHeight
    bar.style.transform = `scaleX(${max > 0 ? Math.min(1, y / max) : 0})`
    ticking = false
  }
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update) } }, { passive: true })
  update()

  // active nav link
  const links = $$('.nav-links a')
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.isIntersecting) links.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#' + en.target.id))
    })
  }, { rootMargin: '-40% 0px -55% 0px' })
  $$('section[id]').forEach((s) => io.observe(s))
}

function initReveal() {
  const els = $$('.reveal')
  if (!('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('in')); return }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target) } })
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' })
  els.forEach((e) => io.observe(e))

  $$('[data-count]').forEach((el) => {
    animateNumber(el, Number(el.dataset.count), { duration: 1600 })
  })
}

function initSpotlight() {
  document.addEventListener('pointermove', (e) => {
    const card = e.target.closest && e.target.closest('.spot')
    if (!card) return
    const r = card.getBoundingClientRect()
    card.style.setProperty('--mx', e.clientX - r.left + 'px')
    card.style.setProperty('--my', e.clientY - r.top + 'px')
  }, { passive: true })
}

function initRipple() {
  document.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest && e.target.closest('.btn')
    if (!btn || btn.disabled || reduceMotion) return
    const r = btn.getBoundingClientRect()
    const size = Math.max(r.width, r.height)
    const dot = document.createElement('span')
    dot.className = 'ripple'
    dot.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`
    btn.appendChild(dot)
    dot.addEventListener('animationend', () => dot.remove())
  })
}

/* ==========================================================
   Backend status + metrics
   ========================================================== */
let lastTrainedAt = null

function setStatus(state, text) {
  const pill = $('#statusPill')
  pill.dataset.state = state
  $('#statusText').textContent = text
}

async function refreshStatus() {
  try {
    const s = await api('/status', {}, 6000)
    if (s.model_ready) setStatus('ok', 'API online · Model ready')
    else setStatus('warn', 'Model not trained')
    if (s.metrics && s.metrics.trained_at !== lastTrainedAt) renderMetrics(s.metrics)
  } catch (_) {
    setStatus('down', 'API offline')
  }
}

function renderMetrics(m) {
  lastTrainedAt = m.trained_at || null
  $$('.metric').forEach((el) => {
    const v = m[el.dataset.key]
    const valEl = $('.m-val', el)
    const fill = $('.m-bar i', el)
    if (typeof v !== 'number') { valEl.textContent = '—'; fill.style.width = '0'; return }
    animateNumber(valEl, v * 100, { format: (n) => n.toFixed(1) + '%' })
    requestAnimationFrame(() => { fill.style.width = (v * 100).toFixed(1) + '%' })
  })

  if (typeof m.val_roc_auc === 'number') $('#heroAuc').textContent = m.val_roc_auc.toFixed(2)

  const when = m.trained_at ? new Date(m.trained_at).toLocaleString() : null
  const parts = []
  if (when) parts.push('Trained ' + when)
  if (m.n_samples) parts.push(`${m.n_samples} records (${m.n_train} train / ${m.n_val} validation)`)
  $('#trainedAt').textContent = parts.join(' · ') || 'No training run recorded yet.'

  const imp = m.feature_importances
  const host = $('#importance')
  if (imp && Object.keys(imp).length) {
    const rows = Object.entries(imp).sort((a, b) => b[1] - a[1])
    const top = rows[0][1] || 1
    host.innerHTML = rows.map(([k, v], i) => `
      <div class="imp-row" style="--i:${i}">
        <span class="imp-name"></span>
        <span class="imp-track"><i class="imp-fill" data-w="${(v / top * 100).toFixed(1)}"></i></span>
        <span class="imp-pct">${(v * 100).toFixed(1)}%</span>
      </div>`).join('')
    $$('.imp-name', host).forEach((el, i) => { el.textContent = FEATURE_LABELS[rows[i][0]] || rows[i][0] })
    requestAnimationFrame(() => requestAnimationFrame(() => {
      $$('.imp-fill', host).forEach((el) => { el.style.width = el.dataset.w + '%' })
    }))
  }
}

/* ==========================================================
   Prediction form
   ========================================================== */
function fieldOf(name) {
  const el = $(`[name="${name}"]`)
  return el ? el.closest('.field') : null
}

function fieldProblem(form, name) {
  const els = $$(`[name="${name}"]`, form)
  if (!els.length) return null
  if (els[0].type === 'radio') return els.some((r) => r.checked) ? null : 'Please choose an option'
  const el = els[0]
  if (el.value.trim() === '') return 'This field is required'
  if (el.validity.badInput) return 'Enter a valid number'
  if (el.validity.rangeUnderflow || el.validity.rangeOverflow) return `Enter a value between ${el.min} and ${el.max}`
  return null
}

function validateForm(form) {
  let firstBad = null
  const names = [...new Set($$('[name]', form).map((e) => e.name))]
  names.forEach((name) => {
    const field = fieldOf(name)
    const problem = fieldProblem(form, name)
    if (!field) return
    field.classList.toggle('invalid', !!problem)
    $('.err', field).textContent = problem || ''
    if (problem && !firstBad) firstBad = name
  })
  return firstBad
}

function readPayload(form) {
  const p = {}
  for (const [k, v] of new FormData(form).entries()) p[k] = typeof v === 'string' ? v.trim() : v
  NUMERIC_FIELDS.forEach((k) => { if (p[k] !== undefined && p[k] !== '') p[k] = Number(p[k]) })
  return p
}

function riskLevel(pct) { return pct < 35 ? 'low' : pct < 65 ? 'mod' : 'high' }

const VERDICTS = {
  low: 'The model estimates a lower likelihood of heart disease based on these values.',
  mod: 'The model sees a moderate likelihood of heart disease. Consider discussing these results with a clinician.',
  high: 'The model estimates an elevated likelihood of heart disease. A clinical evaluation is strongly recommended.',
}
const BADGES = { low: 'Low risk', mod: 'Moderate risk', high: 'High risk' }

function setResultState(state, risk) {
  const card = $('#resultCard')
  card.dataset.state = state
  if (risk) card.dataset.risk = risk
  else delete card.dataset.risk
}

function renderResult(data, payload) {
  const prob = typeof data.probability === 'number' ? data.probability : (data.prediction ? 1 : 0)
  const pct = Math.round(prob * 100)
  const level = riskLevel(pct)
  const card = $('#resultCard')

  setResultState('result', level)
  $('#riskBadge').textContent = BADGES[level]
  $('#verdict').textContent = VERDICTS[level]

  const bar = $('#gaugeBar')
  void bar.getBoundingClientRect() // flush so the stroke animates from its previous value
  bar.style.strokeDashoffset = String(100 - pct)
  animateNumber($('#riskNum'), pct, { duration: 1500 })

  const list = $('#keyFactors')
  list.innerHTML = ''
  factorsFor(payload).forEach((f, i) => {
    const li = document.createElement('li')
    li.className = 'f-' + f.level
    li.style.setProperty('--i', i)
    li.innerHTML = '<span class="f-ico"></span><span class="f-text"></span><span class="f-tag"></span>'
    $('.f-ico', li).textContent = f.icon
    $('.f-text', li).textContent = f.text
    $('.f-tag', li).textContent = f.tag
    list.appendChild(li)
  })

  card.classList.remove('pop'); void card.offsetWidth; card.classList.add('pop')
  if (innerWidth <= 980) card.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' })
}

// Rule-of-thumb indicators computed from the entered values (not from the model).
function factorsFor(p) {
  const out = []
  const chol = Number(p.Cholesterol), bp = Number(p.RestingBP), age = Number(p.Age)
  const maxHR = Number(p.MaxHR), op = Number(p.Oldpeak)

  if (chol === 0) out.push({ level: 'info', icon: '🧪', text: 'Cholesterol not provided', tag: 'Estimated' })
  else if (chol > 240) out.push({ level: 'risk', icon: '🧪', text: `High cholesterol (${chol} mg/dL)`, tag: 'High' })
  else if (chol >= 200) out.push({ level: 'warn', icon: '🧪', text: `Borderline cholesterol (${chol} mg/dL)`, tag: 'Borderline' })
  else out.push({ level: 'good', icon: '🧪', text: `Healthy cholesterol (${chol} mg/dL)`, tag: 'Normal' })

  if (bp >= 140) out.push({ level: 'risk', icon: '🩺', text: `High blood pressure (${bp} mmHg)`, tag: 'High' })
  else if (bp >= 130) out.push({ level: 'warn', icon: '🩺', text: `Elevated blood pressure (${bp} mmHg)`, tag: 'Elevated' })
  else if (bp > 0) out.push({ level: 'good', icon: '🩺', text: `Normal blood pressure (${bp} mmHg)`, tag: 'Normal' })

  if (p.ExerciseAngina === 'Y') out.push({ level: 'risk', icon: '⚡', text: 'Chest pain during exercise', tag: 'Risk' })
  if (p.ChestPainType === 'ASY') out.push({ level: 'risk', icon: '💔', text: 'Asymptomatic chest pain type — most associated with disease in this dataset', tag: 'Risk' })
  if (p.ST_Slope === 'Flat' || p.ST_Slope === 'Down') {
    out.push({ level: p.ST_Slope === 'Down' ? 'risk' : 'warn', icon: '📉', text: `${p.ST_Slope} ST slope during peak exercise`, tag: p.ST_Slope === 'Down' ? 'Risk' : 'Watch' })
  } else if (p.ST_Slope === 'Up') out.push({ level: 'good', icon: '📈', text: 'Upsloping ST segment', tag: 'Normal' })

  if (op >= 2) out.push({ level: 'risk', icon: '📊', text: `Significant ST depression (${op})`, tag: 'High' })
  else if (op >= 1) out.push({ level: 'warn', icon: '📊', text: `Mild ST depression (${op})`, tag: 'Mild' })

  if (age >= 65) out.push({ level: 'warn', icon: '🎂', text: 'Age 65 or older', tag: 'Age' })
  if (age > 0 && maxHR > 0 && maxHR < (220 - age) * 0.7) out.push({ level: 'warn', icon: '❤️', text: `Low peak heart rate (${maxHR} bpm)`, tag: 'Low' })
  if (Number(p.FastingBS) === 1) out.push({ level: 'warn', icon: '🍬', text: 'Fasting blood sugar above 120 mg/dL', tag: 'Elevated' })
  if (p.RestingECG === 'ST' || p.RestingECG === 'LVH') out.push({ level: 'warn', icon: '📟', text: p.RestingECG === 'LVH' ? 'Left ventricular hypertrophy on ECG' : 'ST-T wave abnormality on ECG', tag: 'ECG' })

  const rank = { risk: 0, warn: 1, info: 2, good: 3 }
  return out.sort((a, b) => rank[a.level] - rank[b.level]).slice(0, 6)
}

function initPredictForm() {
  const form = $('#predictForm')
  const btn = $('#predictBtn')

  // clear a field's error as soon as the user edits it
  form.addEventListener('input', (e) => {
    const field = e.target.closest('.field')
    if (field && field.classList.contains('invalid') && !fieldProblem(form, e.target.name)) {
      field.classList.remove('invalid'); $('.err', field).textContent = ''
    }
  })

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const bad = validateForm(form)
    if (bad) {
      const el = $(`[name="${bad}"]`, form)
      el.focus({ preventScroll: true })
      el.closest('.field').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' })
      toast('Please fix the highlighted fields.', 'warn')
      return
    }
    const payload = readPayload(form)
    payload.FastingBS = Number(payload.FastingBS)

    setLoading(btn, true, 'Analyzing…')
    setResultState('loading')
    try {
      const [data] = await Promise.all([
        api('/predict', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
        sleep(500), // keep the loading state visible long enough to read
      ])
      renderResult(data, payload)
    } catch (err) {
      $('#errorMsg').textContent = err.message
      setResultState('error')
      if (err.offline) setStatus('down', 'API offline')
      toast(err.offline ? 'Backend is unreachable.' : 'Prediction failed.', 'error')
    } finally {
      setLoading(btn, false, 'Analyze risk')
    }
  })

  $('#resetBtn').addEventListener('click', () => {
    form.reset()
    $$('.field.invalid', form).forEach((f) => { f.classList.remove('invalid'); $('.err', f).textContent = '' })
    setResultState('empty')
  })
  $('#retryBtn').addEventListener('click', () => setResultState('empty'))

  $$('[data-sample]').forEach((chip) => chip.addEventListener('click', () => {
    const s = SAMPLES[chip.dataset.sample]
    Object.entries(s).forEach(([k, v]) => {
      const els = $$(`[name="${k}"]`, form)
      if (els[0] && els[0].type === 'radio') els.forEach((r) => { r.checked = r.value === String(v) })
      else if (els[0]) els[0].value = v
    })
    $$('.field.invalid', form).forEach((f) => { f.classList.remove('invalid'); $('.err', f).textContent = '' })
    toast(chip.textContent.replace(/^\S+\s/, '') + ' loaded — press Analyze risk.', 'info', 2800)
  }))
}

/* ==========================================================
   Training panel
   ========================================================== */
async function validateCSV(file) {
  const MAX = 5 * 1024 * 1024
  if (!file.name.toLowerCase().endsWith('.csv')) return 'Please choose a .csv file.'
  if (file.size > MAX) return `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 5 MB.`
  if (file.size === 0) return 'The file is empty.'
  try {
    const text = (await file.slice(0, 4096).text()).replace(/^﻿/, '') // strip BOM
    const header = text.split(/\r?\n/)[0]
    const cols = header.split(',').map((h) => h.trim().replace(/^["']|["']$/g, ''))
    const missing = REQUIRED_COLUMNS.filter((c) => !cols.includes(c))
    if (missing.length) return `Missing required columns: ${missing.join(', ')}`
  } catch (e) {
    return 'Could not read the file: ' + e.message
  }
  return null
}

function confirmDialog(text) {
  const dlg = $('#confirmDlg')
  $('#confirmText').textContent = text
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true })
    dlg.returnValue = 'cancel'
    dlg.showModal()
  })
}

function initTraining() {
  const fileInput = $('#file')
  const zone = $('#dropzone')
  const clearBtn = $('#clearFile')
  const slider = $('#val_size')
  const trainBtn = $('#trainBtn')
  let chosen = null

  const paintSlider = () => {
    const min = Number(slider.min), max = Number(slider.max)
    slider.style.setProperty('--fill', ((slider.value - min) / (max - min) * 100) + '%')
    $('#valOut').textContent = Math.round(slider.value * 100) + '%'
  }
  slider.addEventListener('input', paintSlider)
  paintSlider()

  function setFile(file) {
    chosen = file
    zone.classList.toggle('has-file', !!file)
    clearBtn.hidden = !file
    $('#dzTitle').textContent = file ? file.name : 'Drop a CSV here or browse'
    if (!file) $('#dzTitle').innerHTML = 'Drop a CSV here or <u>browse</u>'
    $('#dzSub').textContent = file ? `${(file.size / 1024).toFixed(1)} KB · ready to upload` : 'Optional · max 5 MB · must include all 11 features + HeartDisease'
  }

  async function accept(file) {
    if (!file) return
    const problem = await validateCSV(file)
    if (problem) { toast(problem, 'error', 6000); fileInput.value = ''; setFile(null); return }
    setFile(file)
  }

  fileInput.addEventListener('change', () => accept(fileInput.files[0]))
  clearBtn.addEventListener('click', () => { fileInput.value = ''; setFile(null) })
  ;['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('drag') }))
  ;['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('drag') }))
  zone.addEventListener('drop', (e) => {
    const f = e.dataTransfer.files[0]
    if (f) { try { const dt = new DataTransfer(); dt.items.add(f); fileInput.files = dt.files } catch (_) {} accept(f) }
  })

  trainBtn.addEventListener('click', async () => {
    const source = chosen ? `"${chosen.name}"` : 'the bundled dataset (heart.csv)'
    const ok = await confirmDialog(`The current model will be replaced by one trained on ${source} with a ${Math.round(slider.value * 100)}% validation split.`)
    if (!ok) { toast('Training cancelled.', 'info', 2200); return }

    const form = new FormData()
    if (chosen) form.append('file', chosen)
    form.append('val_size', slider.value)
    const secret = $('#train_secret').value
    if (secret) form.append('train_secret', secret)

    setLoading(trainBtn, true, 'Training…')
    try {
      const data = await api('/train', { method: 'POST', body: form }, 180000)
      renderMetrics(data)
      toast(`Training complete — validation accuracy ${(data.val_accuracy * 100).toFixed(1)}%.`, 'success')
      setStatus('ok', 'API online · Model ready')
    } catch (err) {
      toast(err.message, 'error', 7000)
      if (err.offline) setStatus('down', 'API offline')
    } finally {
      setLoading(trainBtn, false, 'Train model')
    }
  })
}

/* ==========================================================
   Boot
   ========================================================== */
document.addEventListener('DOMContentLoaded', () => {
  initTheme()
  initScrollEffects()
  initReveal()
  initSpotlight()
  initRipple()
  initPredictForm()
  initTraining()
  refreshStatus()
  setInterval(refreshStatus, 15000)
  addEventListener('focus', refreshStatus)
})
