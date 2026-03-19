import React, { useEffect, useRef } from 'react'
import {
  Chart, LineElement, PointElement, LinearScale, TimeScale,
  Tooltip, Legend, Filler, CategoryScale, type ChartConfiguration,
} from 'chart.js'

Chart.register(LineElement, PointElement, LinearScale, TimeScale, Tooltip, Legend, Filler, CategoryScale)

interface Point { t: string; v: number }
interface Props {
  equity: Point[]
  hodl:   Point[]
  capital: number
}

export default function EquityCurveChart({ equity, hodl, capital }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const chartRef  = useRef<Chart | null>(null)

  useEffect(() => {
    if (!canvasRef.current || !equity.length) return
    chartRef.current?.destroy()

    const labels    = equity.map(p => p.t)
    const equityVals = equity.map(p => p.v)
    const hodlVals   = hodl.map(p => p.v)

    const cfg: ChartConfiguration = {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'CMSI Strategy',
            data:  equityVals,
            borderColor: '#6c63ff',
            backgroundColor: 'rgba(108,99,255,0.08)',
            fill: true,
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0.3,
          },
          {
            label: 'Buy & Hold',
            data:  hodlVals,
            borderColor: '#444466',
            backgroundColor: 'transparent',
            fill: false,
            borderWidth: 1,
            pointRadius: 0,
            borderDash: [4, 4],
            tension: 0.3,
          },
          {
            label: 'Capital',
            data:  labels.map(() => capital),
            borderColor: '#2a2a45',
            backgroundColor: 'transparent',
            fill: false,
            borderWidth: 1,
            pointRadius: 0,
            borderDash: [2, 8],
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            labels: { color: '#7878aa', font: { family: 'JetBrains Mono', size: 10 }, boxWidth: 20 },
          },
          tooltip: {
            backgroundColor: '#12121f',
            borderColor: '#1e1e3a',
            borderWidth: 1,
            titleColor: '#6c63ff',
            bodyColor: '#e8e8f0',
            titleFont: { family: 'JetBrains Mono', size: 10 },
            bodyFont:  { family: 'JetBrains Mono', size: 10 },
            callbacks: {
              label: ctx => ` ${ctx.dataset.label}: $${(ctx.parsed.y as number).toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
            },
          },
        },
        scales: {
          x: {
            ticks: {
              color: '#44445a',
              font: { family: 'JetBrains Mono', size: 9 },
              maxTicksLimit: 10,
              maxRotation: 0,
            },
            grid: { color: '#1e1e3a' },
          },
          y: {
            ticks: {
              color: '#44445a',
              font: { family: 'JetBrains Mono', size: 9 },
              callback: (v: any) => '$' + Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 }),
            },
            grid: { color: '#1e1e3a' },
          },
        },
      },
    }
    chartRef.current = new Chart(canvasRef.current, cfg)
    return () => { chartRef.current?.destroy() }
  }, [equity, hodl, capital])

  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
}
