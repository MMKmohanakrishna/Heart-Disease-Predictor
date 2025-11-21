// API base (adjustable). If you serve the frontend from the same host, you can set as empty string.
const API_BASE = "http://127.0.0.1:8000"

// Validate predict payload has required fields
function validatePredictPayload(payload){
  const required = ['Age','Sex','ChestPainType','RestingBP','Cholesterol','FastingBS','RestingECG','MaxHR','ExerciseAngina','Oldpeak','ST_Slope']
  const missing = []
  for (const k of required){
    const v = payload[k]
    if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) missing.push(k)
  }
  return { valid: missing.length === 0, missing }
}
function showTrainMessage(msg){
  const el = document.getElementById('trainResult')
  if (el) el.textContent = msg
  else console.log('trainResult:', msg)
}

// global listeners to capture unexpected errors (helps debugging in-browser)
window.addEventListener('error', (e) => {
  console.error('Uncaught error:', e.error || e.message, e)
  try{ showPredictMessage('Prediction error: ' + (e.message || e.error && e.error.message || 'unknown')) }catch(_){}
})
window.addEventListener('unhandledrejection', (ev) => {
  console.error('Unhandled promise rejection:', ev.reason)
  try{ showPredictMessage('Prediction error: ' + (ev.reason && ev.reason.message ? ev.reason.message : String(ev.reason))) }catch(_){}
})

function showPredictMessage(msg){
  const el = document.getElementById('predictResult')
  if (el) el.textContent = msg
  else console.log('predictResult:', msg)
}

// CSV validation helper
async function validateCSV(file) {
  const MAX_SIZE = 5 * 1024 * 1024 // 5 MB
  const REQUIRED_COLUMNS = ['Age','Sex','ChestPainType','RestingBP','Cholesterol','FastingBS','RestingECG','MaxHR','ExerciseAngina','Oldpeak','ST_Slope','HeartDisease']
  
  if (file.size > MAX_SIZE) {
    return { valid: false, error: `File too large (${(file.size/1024/1024).toFixed(1)} MB). Maximum: 5 MB` }
  }
  
  if (!file.name.toLowerCase().endsWith('.csv')) {
    return { valid: false, error: 'Please upload a CSV file' }
  }
  
  // Read first line to check columns
  try {
    const text = await file.slice(0, 2048).text()
    const firstLine = text.split('\n')[0]
    const headers = firstLine.split(',').map(h => h.trim().replace(/['"]/g, ''))
    
    const missing = REQUIRED_COLUMNS.filter(col => !headers.includes(col))
    if (missing.length > 0) {
      return { valid: false, error: `Missing required columns: ${missing.join(', ')}` }
    }
    
    return { valid: true }
  } catch (e) {
    return { valid: false, error: `Failed to read CSV: ${e.message}` }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const trainBtn = document.getElementById('trainBtn')
  if (trainBtn){
    trainBtn.addEventListener('click', async () => {
      const fileInput = document.getElementById('file')
      const valInput = document.getElementById('val_size')
      const secretInput = document.getElementById('train_secret')
      const file = fileInput ? fileInput.files[0] : null
      
      // Client-side validation if file uploaded
      if (file) {
        showTrainMessage('Validating CSV...')
        const validation = await validateCSV(file)
        if (!validation.valid) {
          showTrainMessage('❌ ' + validation.error)
          return
        }
      }
      
      // Confirmation dialog
      const dataSource = file ? file.name : 'default dataset (heart.csv)'
      if (!confirm(`Train model with ${dataSource}?\n\nThis will replace the current model.`)) {
        showTrainMessage('Training cancelled')
        return
      }
      
      const form = new FormData()
      if (file) form.append('file', file)
      if (valInput) form.append('val_size', valInput.value)
      if (secretInput && secretInput.value) form.append('train_secret', secretInput.value)

      // Disable button and show progress
      trainBtn.disabled = true
      trainBtn.textContent = 'Training...'
      showTrainMessage('⏳ Training model, please wait...')
      
      try{
        // Quick health check to give a clearer error if the backend isn't running
        try {
          const health = await fetch(API_BASE + '/health')
          if (!health.ok) {
            showTrainMessage('❌ Train failed: backend health check returned non-OK status')
            trainBtn.disabled = false
            trainBtn.textContent = 'Train Model'
            return
          }
        } catch (hErr) {
          showTrainMessage('❌ Train error: Cannot reach backend at ' + API_BASE + '. Please start the backend (uvicorn) and try again. (' + (hErr.message || hErr) + ')')
          console.error('Backend health check failed', hErr)
          trainBtn.disabled = false
          trainBtn.textContent = 'Train Model'
          return
        }

        const res = await fetch(API_BASE + '/train', {method: 'POST', body: form})
        if (!res.ok){
          let txt = await res.text()
          try{ txt = JSON.parse(txt) }catch(e){}
          showTrainMessage('❌ Train failed: ' + JSON.stringify(txt))
          return
        }
        const data = await res.json()
        // show returned metrics
        const metrics = []
        if (data.train_accuracy!==undefined) metrics.push(`train_acc=${data.train_accuracy.toFixed(3)}`)
        if (data.val_accuracy!==undefined) metrics.push(`val_acc=${data.val_accuracy.toFixed(3)}`)
        if (data.val_f1!==undefined) metrics.push(`val_f1=${data.val_f1.toFixed(3)}`)
        if (data.val_roc_auc!==undefined && data.val_roc_auc!==null) metrics.push(`val_auc=${data.val_roc_auc.toFixed(3)}`)
        showTrainMessage('✓ Training complete! ' + metrics.join(' | '))
      }catch(err){
        showTrainMessage('❌ Train error: '+String(err))
        console.error(err)
      } finally {
        trainBtn.disabled = false
        trainBtn.textContent = 'Train Model'
      }
    })
  } else {
    console.warn('trainBtn not found')
  }

  const predictForm = document.getElementById('predictForm')
  if (predictForm){
    predictForm.addEventListener('submit', async (e) => {
      e.preventDefault()
      const fd = new FormData(e.target)
      const payload = {}
      for (const pair of fd.entries()) payload[pair[0]] = pair[1]

      // convert numeric fields
      // ensure numeric conversion only runs on a defined array
      const numericFields1 = ['Age','RestingBP','Cholesterol','FastingBS','MaxHR','Oldpeak']
      if (Array.isArray(numericFields1)) {
        numericFields1.forEach(k=>{
          if (payload[k] !== undefined) {
            const n = Number(payload[k])
            payload[k] = Number.isNaN(n) ? payload[k] : n
          }
        })
      } else {
        console.warn('Expected numeric fields array, got:', numericFields1)
      }

      // validate payload before sending
      const vres = validatePredictPayload(payload)
      if (!vres.valid){
        showPredictMessage('Please fill required fields: ' + vres.missing.join(', '))
        const panel = document.getElementById('analysisPanel')
        if (panel) panel.style.display = 'none'
        return
      }
      showPredictMessage('Predicting...')
      try{
        const res = await fetch(API_BASE + '/predict', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify(payload)
        })
        if (!res.ok){
          const txt = await res.text()
          let pretty = txt
          try{ pretty = JSON.stringify(JSON.parse(txt)) }catch(e){}
          showPredictMessage('Prediction failed: ' + pretty)
          console.error('Predict failed', txt)
          return
        }
        const data = await res.json()
        const prob = data.probability ?? null
        showPredictMessage(`Prediction: ${data.prediction} (prob: ${prob?prob.toFixed(3):'n/a'})`)
        // draw pie chart
        try{
          drawProbChart(prob)
        }catch(e){console.error('chart error',e)}
      }catch(err){
        showPredictMessage('Prediction error: '+String(err))
        console.error(err)
      }
    })
  } else {
    console.warn('predictForm not found')
  }

  // Predict button (explicit click) - collects values from the form and submits via fetch
  const predictBtn = document.getElementById('predictBtn')
  if (predictBtn){
    predictBtn.addEventListener('click', async () => {
      try{
        const form = document.getElementById('predictForm')
        if (!form){
          console.warn('predictForm missing')
          return
        }
        const fd = new FormData(form)
        const payload = {}
        for (const pair of fd.entries()) payload[pair[0]] = pair[1]
        // convert numeric fields
        // numeric conversion with defensive guard
        const numericFields2 = ['Age','RestingBP','Cholesterol','FastingBS','MaxHR','Oldpeak']
        if (Array.isArray(numericFields2)) {
          numericFields2.forEach(k=>{
            if (payload[k] !== undefined) {
              const n = Number(payload[k])
              payload[k] = Number.isNaN(n) ? payload[k] : n
            }
          })
        } else {
          console.warn('Expected numeric fields array, got:', numericFields2)
        }

        // validate payload before sending
        const vres = validatePredictPayload(payload)
        if (!vres.valid){
          showPredictMessage('Please fill required fields: ' + vres.missing.join(', '))
          const panel = document.getElementById('analysisPanel')
          if (panel) panel.style.display = 'none'
          return
        }
        // UI feedback
        predictBtn.disabled = true
        predictBtn.textContent = 'Predicting...'
        showPredictMessage('Predicting...')

        const res = await fetch(API_BASE + '/predict', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify(payload)
        })
        if (!res.ok){
          const txt = await res.text()
          let pretty = txt
          try{ pretty = JSON.stringify(JSON.parse(txt)) }catch(e){}
          showPredictMessage('Prediction failed: ' + pretty)
          console.error('Predict failed', txt)
          // ensure button re-enabled on early return
          predictBtn.disabled = false
          predictBtn.textContent = 'Predict'
          return
        }
        const data = await res.json()
        const prob = data.probability ?? null
        showPredictMessage(`Prediction: ${data.prediction} (prob: ${prob?prob.toFixed(3):'n/a'})`)
        try{ 
          drawProbChart(prob)
          displayKeyFactors(payload)
          // show the analysis panel now that we have results
          const panel = document.getElementById('analysisPanel')
          if (panel) panel.style.display = 'block'
        }catch(e){ 
          console.error('chart',e)
        }
      }catch(err){
        showPredictMessage('Prediction error: '+String(err))
        console.error(err)
        // hide analysis panel on error
        const panel = document.getElementById('analysisPanel')
        if (panel) panel.style.display = 'none'
      } finally {
        predictBtn.disabled = false
        predictBtn.textContent = 'Predict'
      }
    })
  }
})

// Test Predict button (sends a fixed sample payload) to help debug
// Test predict button removed from UI; debug/test can be done via browser console or API calls.

function drawProbChart(prob){
  const canvas = document.getElementById('probChart')
  const label = document.getElementById('probLabel')
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0,0,w,h)
  const centerX = w/2
  const centerY = h/2
  const radius = Math.min(w,h)/2 - 10
  const p = (typeof prob === 'number' && !Number.isNaN(prob)) ? Math.max(0, Math.min(1, prob)) : null
  const probPercent = p===null? null : Math.round(p*100)
  // draw background circle (no disease)
  const start = -Math.PI/2
  ctx.beginPath(); ctx.moveTo(centerX,centerY);
  ctx.fillStyle = '#2f88ff'
  ctx.arc(centerX, centerY, radius, 0, Math.PI*2); ctx.fill();
  if (p!==null){
  // arc for probability (disease)
  ctx.beginPath();
  ctx.moveTo(centerX,centerY);
  ctx.fillStyle = '#ff0000ff'
    const endAngle = start + (Math.PI*2) * p
    ctx.arc(centerX, centerY, radius, start, endAngle);
    ctx.closePath(); ctx.fill();
    // draw white inner circle to make donut
    ctx.beginPath(); ctx.fillStyle='white'; ctx.arc(centerX,centerY,radius*0.6,0,Math.PI*2); ctx.fill();
    
    // Draw text inside the chart
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    
    // "Risk Score:" text
    ctx.fillStyle = '#000000ff'
    ctx.font = 'bold 14px Arial'
    ctx.fillText('Risk Score:', centerX, centerY - 15)
    
    // Percentage text (blue when 0% risk, red otherwise)
    const percentColor = (probPercent === 0) ? '#2f88ff' : '#ff0000'
    ctx.fillStyle = percentColor
    ctx.font = 'bold 32px Arial'
    ctx.fillText(probPercent + '%', centerX, centerY + 15)
    
    label.textContent = `Heart Disease Risk: ${probPercent}%`
  } else {
    // draw grey inner circle and label
    ctx.beginPath(); ctx.fillStyle='white'; ctx.arc(centerX,centerY,radius*0.6,0,Math.PI*2); ctx.fill();
    
    // Draw "N/A" text
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#999'
    ctx.font = 'bold 14px Arial'
    ctx.fillText('Risk Score:', centerX, centerY - 15)
    ctx.font = 'bold 24px Arial'
    ctx.fillText('N/A', centerX, centerY + 12)
    
    label.textContent = 'No prediction available'
  }
}

function displayKeyFactors(patientData) {
  const container = document.getElementById('keyFactors')
  if (!container) return
  
  const factors = []
  
  // Analyze Cholesterol
  const chol = Number(patientData.Cholesterol)
  if (chol > 240) {
    factors.push({ icon: '❤️', text: 'High Cholesterol', color: '#999' })
  } else if (chol >= 200 && chol <= 240) {
    factors.push({ icon: '❤️', text: 'Borderline High Cholesterol', color: '#999' })
  } else if (chol > 0) {
    factors.push({ icon: '✓', text: 'Normal Cholesterol', color: '#999' })
  }
  
  // Analyze Blood Pressure
  const bp = Number(patientData.RestingBP)
  if (bp >= 140) {
    factors.push({ icon: '🩺', text: 'High Blood Pressure', color: '#999' })
  } else if (bp >= 130) {
    factors.push({ icon: '🩺', text: 'Elevated Blood Pressure', color: '#999' })
  } else if (bp > 0) {
    factors.push({ icon: '✓', text: 'Normal Blood Pressure', color: '#999' })
  }
  
  // Analyze Exercise Angina
  if (patientData.ExerciseAngina === 'Y') {
    factors.push({ icon: '⚠️', text: 'Exercise-Induced Chest Pain', color: '#999' })
  }
  
  // Analyze Chest Pain Type
  if (patientData.ChestPainType === 'ASY') {
    factors.push({ icon: '💔', text: 'Asymptomatic Chest Pain', color: '#999' })
  }
  
  // Analyze Age
  const age = Number(patientData.Age)
  if (age >= 65) {
    factors.push({ icon: '👤', text: 'Senior Age Risk Factor', color: '#999' })
  }
  
  // Analyze Max Heart Rate
  const maxHR = Number(patientData.MaxHR)
  const expectedMaxHR = 220 - age
  if (maxHR < expectedMaxHR * 0.7) {
    factors.push({ icon: '❤️', text: 'Low Max Heart Rate', color: '#999' })
  }
  
  // Analyze Lifestyle (FastingBS as proxy)
  const fbs = Number(patientData.FastingBS)
  if (fbs === 1) {
    factors.push({ icon: '🍬', text: 'Elevated Fasting Blood Sugar', color: '#999' })
  }
  
  // Check for sedentary lifestyle indicators (ST_Slope)
  if (patientData.ST_Slope === 'Flat' || patientData.ST_Slope === 'Down') {
    factors.push({ icon: '🪑', text: 'Sedentary Lifestyle Indicator', color: '#999' })
  }
  
  // If no significant factors found
  if (factors.length === 0) {
    factors.push({ icon: '✓', text: 'No major risk factors detected', color: '#999' })
  }
  
  // Display factors (limit to 3 most important)
  container.innerHTML = factors.slice(0, 3).map(f => 
    `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
      <span style="font-size:20px">${f.icon}</span>
      <span style="color:${f.color};font-weight:500">${f.text}</span>
    </div>`
  ).join('')
}
