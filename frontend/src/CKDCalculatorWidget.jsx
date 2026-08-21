import React, { useState } from 'react';

const presetQueries = [
  { label: 'Normal (Stage 1)', creatinine: 0.9, age: 30, sex: 'male', acr: 10 },
  { label: 'Early CKD (Stage 2)', creatinine: 1.2, age: 52, sex: 'male', acr: 45 },
  { label: 'Moderate (Stage 3a)', creatinine: 1.5, age: 65, sex: 'female', acr: 150 },
  { label: 'Severe (Stage 4)', creatinine: 2.8, age: 70, sex: 'male', acr: 400 },
  { label: 'Failure (Stage 5)', creatinine: 5.5, age: 58, sex: 'female', acr: 900 },
];

export default function CKDCalculatorWidget() {
  const [creatinine, setCreatinine] = useState(1.2);
  const [age, setAge] = useState(55);
  const [sex, setSex] = useState('male');
  const [acr, setAcr] = useState(30);

  const calculateEGFR = (scr, a, s) => {
    let kappa = s === 'female' ? 0.7 : 0.9;
    let alpha = s === 'female' ? -0.329 : -0.411;
    let min = Math.min(scr / kappa, 1);
    let max = Math.max(scr / kappa, 1);
    let base = 141 * Math.pow(min, alpha) * Math.pow(max, -1.209) * Math.pow(0.993, a);
    if (s === 'female') base *= 1.018;
    return Math.round(base);
  };

  const eGFR = calculateEGFR(creatinine, age, sex);

  const getStageInfo = (g) => {
    let stage = 'Stage 1';
    let color = '#38a169';
    if (g >= 90) { stage = 'Stage 1 (Normal)'; color = '#38a169'; }
    else if (g >= 60) { stage = 'Stage 2 (Mild)'; color = '#319795'; }
    else if (g >= 45) { stage = 'Stage 3a (Mild-Mod)'; color = '#d69e2e'; }
    else if (g >= 30) { stage = 'Stage 3b (Mod-Sev)'; color = '#ed8936'; }
    else if (g >= 15) { stage = 'Stage 4 (Severe)'; color = '#e53e3e'; }
    else { stage = 'Stage 5 (Failure)'; color = '#9b2c2c'; }
    return { stage, color };
  };

  const { stage, color } = getStageInfo(eGFR);

  return (
    <div style={{ width: '100%', fontSize: '0.8rem', color: '#e2e8f0', boxSizing: 'border-box' }}>
      {/* Presets */}
      <div style={{ marginBottom: '10px' }}>
        <span style={{ display: 'block', color: '#93c5fd', marginBottom: '6px', fontWeight: '600' }}>Quick Presets:</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {presetQueries.map((pq, idx) => (
            <button
              key={idx}
              onClick={() => { setCreatinine(pq.creatinine); setAge(pq.age); setSex(pq.sex); setAcr(pq.acr); }}
              style={{
                background: '#1e3a8a',
                border: 'none',
                color: '#cbd5e1',
                padding: '4px 8px',
                borderRadius: '4px',
                fontSize: '0.7rem',
                cursor: 'pointer',
                textAlign: 'left',
                width: '100%'
              }}
            >
              {pq.label}
            </button>
          ))}
        </div>
      </div>

      {/* Sliders in a tight layout */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '10px' }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', fontSize: '0.75rem' }}>
            <span>Creatinine:</span>
            <span style={{ color: '#fff', fontWeight: 'bold' }}>{creatinine} mg/dL</span>
          </div>
          <input type="range" min="0.5" max="8.0" step="0.1" value={creatinine} onChange={(e) => setCreatinine(parseFloat(e.target.value))} style={{ width: '100%', accentColor: '#3b82f6', height: '4px' }} />
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', fontSize: '0.75rem' }}>
            <span>Age:</span>
            <span style={{ color: '#fff', fontWeight: 'bold' }}>{age} yrs</span>
          </div>
          <input type="range" min="18" max="95" step="1" value={age} onChange={(e) => setAge(parseInt(e.target.value))} style={{ width: '100%', accentColor: '#3b82f6', height: '4px' }} />
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', fontSize: '0.75rem' }}>
            <span>Urine ACR:</span>
            <span style={{ color: '#fff', fontWeight: 'bold' }}>{acr} mg/g</span>
          </div>
          <input type="range" min="5" max="1000" step="5" value={acr} onChange={(e) => setAcr(parseInt(e.target.value))} style={{ width: '100%', accentColor: '#3b82f6', height: '4px' }} />
        </div>

        <div>
          <span style={{ color: '#94a3b8', fontSize: '0.75rem', display: 'block', marginBottom: '2px' }}>Sex:</span>
          <select value={sex} onChange={(e) => setSex(e.target.value)} style={{ width: '100%', padding: '4px', background: '#1e293b', color: '#fff', border: '1px solid #334155', borderRadius: '4px', fontSize: '0.75rem' }}>
            <option value="male">Male</option>
            <option value="female">Female</option>
          </select>
        </div>
      </div>

      {/* Result Display Box */}
      <div style={{ background: '#111827', padding: '8px', borderRadius: '6px', borderLeft: `4px solid ${color}` }}>
        <div style={{ fontSize: '0.65rem', color: '#9ca3af' }}>eGFR Result</div>
        <div style={{ fontSize: '1rem', fontWeight: 'bold', color: '#f3f4f6' }}>{eGFR} <span style={{ fontSize: '0.6rem', fontWeight: 'normal' }}>mL/min</span></div>
        <div style={{ marginTop: '2px', fontSize: '0.7rem', fontWeight: '600', color: color }}>{stage}</div>
      </div>
    </div>
  );
}