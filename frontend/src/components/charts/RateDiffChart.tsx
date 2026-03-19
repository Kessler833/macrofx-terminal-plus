import React, { useEffect, useRef } from 'react'
import { Chart, BarElement, CategoryScale, LinearScale, Tooltip, type ChartConfiguration } from 'chart.js'

Chart.register(BarElement, CategoryScale, LinearScale, Tooltip)

interface Props {
  data: { pair: string; diff: number }[]
}

export default function RateDiffChart({ data }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const chartRef  = useRef<Chart | null>(null)

  useEffect(() => {
    if (!canvasRef.current || !data.length) return
    chartRef.current?.destroy()

    const colors = data.map(d => d.diff >= 0 ? 'rgba(0,212,170,0.75)' : 'rgba(255,68,102,0.75)')
    const borders = data.map(d => d.diff >= 0 ? '#00d4aa' : '#ff4466')

    const cfg: ChartConfiguration = {
      type: 'bar',
      data: {
        labels: data.map(d => d.pair),
        datasets: [{
          data:            data.map(d => d.diff),
          backgroundColor: colors,
          borderColor:     borders,
          borderWidth:     1,
          borderRadius:    2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#12121f',
            borderColor: '#1e1e3a',
            borderWidth: 1,
            titleColor: '#6c63ff',
            bodyColor: '#e8e8f0',
            titleFont: { family: 'JetBrains Mono', size: 10 },
            bodyFont:  { family: 'JetBrains Mono', size: 10 },
            callbacks: {
              label: ctx => ` Rate Diff: ${(ctx.parsed.y as number).toFixed(2)}%`,
            },
          },
        },
        scales: {
          x: {
            ticks: { color: '#7878aa', font: { family: 'JetBrains Mono', size: 9 } },
            grid:  { display: false },
          },
          y: {
            ticks: {
              color: '#44445a',
              font: { family: 'JetBrains Mono', size: 9 },
              callback: (v: any) => v.toFixed(1) + '%',
            },
            grid: { color: '#1e1e3a' },
          },
        },
      },
    }
    chartRef.current = new Chart(canvasRef.current, cfg)
    return () => { chartRef.current?.destroy() }
  }, [data])

  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
}
