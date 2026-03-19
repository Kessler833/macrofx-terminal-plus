const { app, BrowserWindow, ipcMain, session } = require('electron')
const { spawn } = require('child_process')
const path = require('path')
const http = require('http')
const fs   = require('fs')

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged
const BACKEND_PORT = 8766

// In dev mode load Vite dev server; in prod load the built bundle
function getFrontendURL() {
  if (isDev) return 'http://localhost:5173'
  const distPath = path.join(__dirname, '..', 'frontend', 'dist', 'index.html')
  if (fs.existsSync(distPath)) return `file://${distPath}`
  // Fallback: if dist doesn't exist yet, still try dev server
  console.warn('[electron] dist not found, falling back to dev server')
  return 'http://localhost:5173'
}

let win       = null
let pyProcess = null

function resolvePython() {
  const root = path.join(__dirname, '..')
  const candidates = [
    path.join(root, '.venv', 'Scripts', 'python.exe'),
    path.join(root, 'venv',  'Scripts', 'python.exe'),
    path.join(root, '.venv', 'bin', 'python'),
    path.join(root, 'venv',  'bin', 'python'),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return process.platform === 'win32' ? 'python' : 'python3'
}

function startPython() {
  const pythonCmd = resolvePython()
  const cwd = path.join(__dirname, '..')
  pyProcess = spawn(
    pythonCmd,
    ['-m', 'uvicorn', 'backend.server:app',
     '--host', '127.0.0.1', '--port', String(BACKEND_PORT), '--no-access-log'],
    { cwd, stdio: 'pipe', env: { ...process.env, PYTHONUNBUFFERED: '1' } }
  )
  pyProcess.stdout.on('data', d => console.log('[python]', d.toString().trim()))
  pyProcess.stderr.on('data', d => console.error('[python]', d.toString().trim()))
  pyProcess.on('exit', code => console.log('[python] exited', code))
  pyProcess.on('error', err => console.error('[python] spawn error:', err.message))
}

function waitForBackend(maxMs = 30000) {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    function poll() {
      http.get(`http://127.0.0.1:${BACKEND_PORT}/health`, res => {
        if (res.statusCode === 200) return resolve()
        retry()
      }).on('error', retry)
    }
    function retry() {
      if (Date.now() - start > maxMs) return reject(new Error('Backend timeout after 30s'))
      setTimeout(poll, 600)
    }
    poll()
  })
}

async function createWindow() {
  startPython()

  try {
    await waitForBackend()
    console.log('[electron] Backend ready ✓')
  } catch (e) {
    console.error('[electron] Backend failed to start:', e.message)
  }

  // Relax CSP in dev so Vite HMR websocket works
  if (isDev) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self' 'unsafe-inline' 'unsafe-eval' " +
            "http://localhost:* http://127.0.0.1:* " +
            "ws://localhost:* ws://127.0.0.1:* https://*"
          ]
        }
      })
    })
  }

  win = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1200,
    minHeight: 720,
    backgroundColor: '#0a0a0f',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
      allowRunningInsecureContent: true,
    },
  })

  const url = getFrontendURL()
  console.log('[electron] Loading:', url)
  win.loadURL(url)

  // Always open DevTools in dev so you can see console errors
  if (isDev) win.webContents.openDevTools({ mode: 'detach' })

  // If the page fails to load (e.g. Vite not running), show error and retry
  win.webContents.on('did-fail-load', (event, errorCode, errorDesc, url) => {
    console.error('[electron] Page failed to load:', errorDesc, url)
    // Retry after 2 seconds in case Vite is still starting up
    setTimeout(() => {
      if (win && !win.isDestroyed()) win.loadURL(getFrontendURL())
    }, 2000)
  })
}

ipcMain.on('window-minimize', () => win?.minimize())
ipcMain.on('window-maximize', () => win?.isMaximized() ? win.unmaximize() : win.maximize())
ipcMain.on('window-close',    () => win?.close())

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (pyProcess) { pyProcess.kill(); pyProcess = null }
  if (process.platform !== 'darwin') app.quit()
})
app.on('before-quit', () => {
  if (pyProcess) { pyProcess.kill(); pyProcess = null }
})
