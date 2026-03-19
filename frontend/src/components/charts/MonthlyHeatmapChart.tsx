import React from 'react'

interface Props {
  data: Record<string, Record<string, number>>  // { "2023": { "01": 2.3, "02": -1.1, ... } }
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const MONTH_KEYS = ['01','02','03','04','05','06','07','08','09','10','11','12']

function getColor(val: number | undefined): string {
  if (val === undefined || val === null) return 'rgba(30,30,58,0.5)'
  if (val > 5)  return 'rgba(0,212,170,0.85)'
  if (val > 2)  return 'rgba(0,212,170,0.55)'
  if (val > 0)  return 'rgba(0,212,170,0.25)'
  if (val > -2) return 'rgba(255,68,102,0.25)'
  if (val > -5) return 'rgba(255,68,102,0.55)'
  return 'rgba(255,68,102,0.85)'
}
function getTextColor(val: number | undefined): string {
  if (val === undefined) return '#44445a'
  if (val > 0) return '#00d4aa'
  if (val < 0) return '#ff4466'
  return '#7878aa'
}

export default function MonthlyHeatmapChart({ data }: Props) {
  const years = Object.keys(data).sort()
  if (!years.length) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#44445a', fontSize: '10px' }}>
      No monthly data
    </div>
  )

  return (
    <div style={{ overflowX: 'auto', width: '100%', height: '100%' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '9px', fontFamily: 'var(--font-mono)' }}>
        <thead>
          <tr>
            <th style={{ padding: '4px 8px', color: '#44445a', textAlign: 'left', width: '40px' }}>YR</th>
            {MONTHS.map(m => (
              <th key={m} style={{ padding: '4px 6px', color: '#7878aa', textAlign: 'center', fontWeight: 600 }}>{m}</th>
            ))}
            <th style={{ padding: '4px 8px', color: '#44445a', textAlign: 'right' }}>ANN</th>
          </tr>
        </thead>
        <tbody>
          {years.map(yr => {
            const row = data[yr] ?? {}
            const vals = MONTH_KEYS.map(m => row[m])
            const annual = vals.reduce((sum, v) => sum + (v ?? 0), 0)
            return (
              <tr key={yr}>
                <td style={{ padding: '3px 8px', color: '#6c63ff', fontWeight: 700 }}>{yr}</td>
                {MONTH_KEYS.map((mk, i) => {
                  const v = vals[i]
                  return (
                    <td key={mk} style={{
                      padding: '3px 6px',
                      textAlign: 'center',
                      background: getColor(v),
                      color: getTextColor(v),
                      borderRadius: '2px',
                      minWidth: '36px',
                      fontWeight: v !== undefined ? 600 : 400,
                    }}>
                      {v !== undefined ? (v > 0 ? '+' : '') + v.toFixed(1) : '—'}
                    </td>
                  )
                })}
                <td style={{
                  padding: '3px 8px',
                  textAlign: 'right',
                  color: annual > 0 ? '#00d4aa' : '#ff4466',
                  fontWeight: 700,
                }}>
                  {annual > 0 ? '+' : ''}{annual.toFixed(1)}%
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
