import { app, BrowserWindow, ipcMain, dialog, protocol, shell, Menu } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import electronUpdater from 'electron-updater'

const { autoUpdater } = electronUpdater

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.DIST = path.join(__dirname, '../dist')
process.env.VITE_PUBLIC = app.isPackaged
  ? process.env.DIST
  : path.join(process.env.DIST, '../public')

const configPath = path.join(app.getPath('userData'), 'config.json')
const defaultImagesDir = path.join(app.getPath('userData'), 'images')
const historyPath = path.join(app.getPath('userData'), 'history.json')
// Multi-conversation storage: an index file with tab metadata + the active tab,
// plus one messages file per conversation under conversations/.
const conversationsDir = path.join(app.getPath('userData'), 'conversations')
const indexPath = path.join(app.getPath('userData'), 'conversations.json')
// User-defined bots: each carries its own Instructions, used in place of the
// global custom instructions for any conversation opened from that bot.
const botsPath = path.join(app.getPath('userData'), 'bots.json')

// Serve stored images to the renderer via media://img/<id> without inlining
// base64 into the DOM or the history file. Must be registered before app ready.
protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
])

// undici's fetch requires `duplex: 'half'` when sending a streamed body (multipart uploads)
function fetchWithDuplex(url, init) {
  if (init && init.body && !('duplex' in init)) {
    return fetch(url, { ...init, duplex: 'half' })
  }
  return fetch(url, init)
}

const store = {
  get(key, defaultValue) {
    try {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      return data[key] ?? defaultValue
    } catch {
      return defaultValue
    }
  },
  set(key, value) {
    let data = {}
    try {
      data = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    } catch {
      // file doesn't exist yet
    }
    data[key] = value
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    fs.writeFileSync(configPath, JSON.stringify(data, null, 2))
  },
}

// ---- Persistent image + chat history storage ----
// The folder where generated images live is user-configurable (defaults to
// userData/images). Read it fresh each time so a change takes effect at once.
function getImagesDir() {
  return store.get('imagesDir', defaultImagesDir) || defaultImagesDir
}

function saveImageFile(b64) {
  const dir = getImagesDir()
  fs.mkdirSync(dir, { recursive: true })
  const id = `${randomUUID()}.png`
  fs.writeFileSync(path.join(dir, id), Buffer.from(b64, 'base64'))
  return id
}

function imagePath(id) {
  // basename guards against path traversal from a crafted id.
  return path.join(getImagesDir(), path.basename(id))
}

// ---- Multi-conversation storage ----
function convPath(id) {
  // basename guards against path traversal from a crafted id.
  return path.join(conversationsDir, `${path.basename(id)}.json`)
}

function readConversation(id) {
  try {
    return JSON.parse(fs.readFileSync(convPath(id), 'utf-8'))
  } catch {
    return []
  }
}

function writeConversation(id, messages) {
  fs.mkdirSync(conversationsDir, { recursive: true })
  fs.writeFileSync(convPath(id), JSON.stringify(messages, null, 2))
}

function readIndex() {
  try {
    const idx = JSON.parse(fs.readFileSync(indexPath, 'utf-8'))
    if (idx && Array.isArray(idx.list)) return idx
  } catch {
    // no index yet
  }
  return null
}

function writeIndex(idx) {
  fs.mkdirSync(path.dirname(indexPath), { recursive: true })
  fs.writeFileSync(indexPath, JSON.stringify(idx, null, 2))
}

// ---- Bot storage ----
function readBots() {
  try {
    const data = JSON.parse(fs.readFileSync(botsPath, 'utf-8'))
    if (Array.isArray(data)) return data
  } catch {
    // no bots yet
  }
  return []
}

function writeBots(bots) {
  fs.mkdirSync(path.dirname(botsPath), { recursive: true })
  fs.writeFileSync(botsPath, JSON.stringify(bots, null, 2))
}

function deriveTitle(messages) {
  if (!Array.isArray(messages)) return null
  const firstUser = messages.find((m) => m.role === 'user' && m.text)
  return firstUser ? firstUser.text.trim().slice(0, 40) : null
}

// Return the conversation index, creating it on first run. A pre-existing
// single-conversation history.json is migrated into the first tab so users
// keep their previous chat after upgrading.
function ensureIndex() {
  const existing = readIndex()
  if (existing) return existing

  let legacy = null
  try {
    legacy = JSON.parse(fs.readFileSync(historyPath, 'utf-8'))
  } catch {
    // no legacy history
  }

  const id = randomUUID()
  const title = deriveTitle(legacy) || 'Cuộc trò chuyện 1'
  writeConversation(id, Array.isArray(legacy) ? legacy : [])
  const idx = { list: [{ id, title, createdAt: Date.now() }], activeId: id }
  writeIndex(idx)
  return idx
}

let win

function createWindow() {
  // Remove the default OS menu bar (File / Edit / View / …) app-wide.
  Menu.setApplicationMenu(null)

  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'ChatDKH',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(process.env.DIST, 'index.html'))
  }
}

// ---- Auto update (electron-updater, GitHub provider) ----
// The user controls the flow with a button: we check + notify, then download
// and install only on request. Live status is forwarded to the renderer.
function sendUpdateStatus(status, data = {}) {
  if (win && !win.isDestroyed()) {
    win.webContents.send('update:status', { status, ...data })
  }
}

function setupAutoUpdater() {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => sendUpdateStatus('checking'))
  autoUpdater.on('update-available', (info) =>
    sendUpdateStatus('available', { version: info?.version })
  )
  autoUpdater.on('update-not-available', () => sendUpdateStatus('not-available'))
  autoUpdater.on('download-progress', (p) =>
    sendUpdateStatus('downloading', { percent: Math.round(p?.percent ?? 0) })
  )
  autoUpdater.on('update-downloaded', (info) =>
    sendUpdateStatus('downloaded', { version: info?.version })
  )
  autoUpdater.on('error', (err) =>
    sendUpdateStatus('error', { message: err == null ? 'unknown' : err.message || String(err) })
  )

  // Silent check on startup so the user is notified a new version exists.
  if (app.isPackaged) {
    autoUpdater.checkForUpdates().catch(() => {
      // offline or no release published yet — ignore
    })
  }
}

app.whenReady().then(() => {
  protocol.handle('media', async (request) => {
    const { pathname } = new URL(request.url) // media://img/<id> -> /<id>
    const id = decodeURIComponent(pathname).replace(/^\/+/, '')
    try {
      const data = await fs.promises.readFile(imagePath(id))
      return new Response(data, { headers: { 'Content-Type': 'image/png' } })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
  createWindow()
  setupAutoUpdater()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// ---- Settings storage ----
ipcMain.handle('settings:get', () => {
  return {
    apiKey: store.get('apiKey', ''),
    baseURL: store.get('baseURL', ''),
    model: store.get('model', 'gpt-image-1'),
    customInstructions: store.get('customInstructions', ''),
    appsScriptUrl: store.get('appsScriptUrl', ''),
    appsScriptSecret: store.get('appsScriptSecret', ''),
  }
})

ipcMain.handle(
  'settings:save',
  (_event, { apiKey, baseURL, model, customInstructions, appsScriptUrl, appsScriptSecret }) => {
    store.set('apiKey', apiKey)
    store.set('baseURL', baseURL)
    store.set('model', model)
    store.set('customInstructions', customInstructions ?? '')
    if (appsScriptUrl !== undefined) store.set('appsScriptUrl', appsScriptUrl ?? '')
    if (appsScriptSecret !== undefined) store.set('appsScriptSecret', appsScriptSecret ?? '')
    return true
  }
)

// ---- Auto update controls (invoked from the renderer) ----
ipcMain.handle('app:getVersion', () => app.getVersion())

ipcMain.handle('update:check', async () => {
  if (!app.isPackaged) return { ok: false, reason: 'dev' }
  try {
    await autoUpdater.checkForUpdates()
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: err.message || String(err) }
  }
})

ipcMain.handle('update:download', async () => {
  try {
    await autoUpdater.downloadUpdate()
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: err.message || String(err) }
  }
})

// Quit and install the downloaded update (relaunches into the new version).
ipcMain.handle('update:install', () => {
  autoUpdater.quitAndInstall()
})

// ---- Image generation ----
function endpointBase() {
  const baseURL = store.get('baseURL', '').trim()
  return (baseURL || 'https://api.openai.com/v1').replace(/\/+$/, '')
}

// Send a progress update for a single image slot to the renderer.
function emitProgress(payload) {
  if (win && !win.isDestroyed()) {
    win.webContents.send('image:generate:progress', payload)
  }
}

// Parse an SSE (text/event-stream) image response, emitting partial frames as
// they arrive and resolving with the final base64 image for this slot.
async function consumeImageStream(res, { index, emit }) {
  const decoder = new TextDecoder()
  let buffer = ''
  let finalB64 = null

  const handleEvent = (raw) => {
    const dataLines = raw
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
    if (dataLines.length === 0) return
    const data = dataLines.join('\n')
    if (data === '[DONE]') return
    let obj
    try {
      obj = JSON.parse(data)
    } catch {
      return
    }
    // Images API streaming events carry their kind in `type`.
    if (obj.type === 'image_generation.partial_image' && obj.b64_json) {
      emit({ index, status: 'partial', b64: obj.b64_json })
    } else if (obj.type === 'image_generation.completed' && obj.b64_json) {
      finalB64 = obj.b64_json
    } else if (obj.b64_json) {
      // Fallback for providers that stream a plain image payload.
      finalB64 = obj.b64_json
    }
  }

  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true })
    let sep
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      handleEvent(buffer.slice(0, sep))
      buffer = buffer.slice(sep + 2)
    }
  }
  if (buffer.trim()) handleEvent(buffer)

  if (!finalB64) throw new Error('Luồng phản hồi không chứa ảnh hoàn chỉnh.')
  return finalB64
}

// Generate a single image into `index`, attempting true partial-image
// streaming and falling back gracefully when the provider doesn't support it.
async function generateOneSlot({ index, prompt, model, size, quality, imageFiles, apiKey, emit, signal }) {
  const base = endpointBase()

  async function request({ stream }) {
    const headers = { Authorization: `Bearer ${apiKey}` }
    let url
    let init

    if (imageFiles) {
      const form = new FormData()
      form.append('model', model)
      form.append('prompt', prompt)
      form.append('n', '1')
      if (size) form.append('size', size)
      if (quality && quality !== 'auto') form.append('quality', quality)
      if (stream) {
        form.append('stream', 'true')
        form.append('partial_images', '2')
      }
      const field = imageFiles.length === 1 ? 'image' : 'image[]'
      for (const f of imageFiles) form.append(field, f, f.name)
      url = `${base}/images/edits`
      init = { method: 'POST', headers, body: form }
    } else {
      const body = { model, prompt, n: 1, size }
      if (quality && quality !== 'auto') body.quality = quality
      if (stream) {
        body.stream = true
        body.partial_images = 2
      }
      url = `${base}/images/generations`
      init = {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    }
    return fetchWithDuplex(url, { ...init, signal })
  }

  let res = await request({ stream: true })

  // Provider rejected the streaming params — retry once without them.
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    res = await request({ stream: false })
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')) || errText
      throw new Error(`API ${res.status}: ${detail.slice(0, 300)}`)
    }
  }

  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('text/event-stream')) {
    const b64 = await consumeImageStream(res, { index, emit })
    emit({ index, status: 'final', b64 })
    return b64
  }

  // Non-streaming JSON response (provider ignored `stream`).
  const json = await res.json()
  const item = json?.data?.[0]
  let b64 = item?.b64_json
  if (!b64 && item?.url) {
    const imgRes = await fetch(item.url, { signal })
    b64 = Buffer.from(await imgRes.arrayBuffer()).toString('base64')
  }
  if (!b64) throw new Error('Phản hồi không chứa dữ liệu ảnh hợp lệ.')
  emit({ index, status: 'final', b64 })
  return b64
}

// In-flight generations keyed by requestId, so a stop request can abort the
// matching network calls without touching other concurrent conversations.
const activeGenerations = new Map()

ipcMain.handle('image:generate', async (_event, { prompt, n, size, quality, referenceImages, persistReferences, instructionsOverride, requestId }) => {
  // Tag every progress frame with the request id so the renderer can route
  // partial images to the right conversation when several run concurrently.
  const emit = (payload) => emitProgress({ ...payload, requestId })
  const controller = new AbortController()
  if (requestId) activeGenerations.set(requestId, controller)
  try {
    const apiKey = store.get('apiKey', '')
    if (!apiKey) {
      throw new Error('Chưa cấu hình OpenAI API key. Vui lòng vào Cài đặt để nhập API key.')
    }
    const model = store.get('model', 'gpt-image-1')

    // Append special requirements (e.g. "no background", "white background")
    // to every prompt. A bot conversation passes its own instructions, which
    // replace the global ones entirely; otherwise fall back to the global.
    const extra = (
      instructionsOverride !== undefined && instructionsOverride !== null
        ? String(instructionsOverride)
        : store.get('customInstructions', '')
    ).trim()
    const fullPrompt = extra ? `${prompt}\n\n${extra}` : prompt

    // Decode reference files once and reuse across the parallel slot requests.
    const imageFiles =
      referenceImages && referenceImages.length > 0
        ? referenceImages.map((img, idx) => {
            const buffer = Buffer.from(img.data, 'base64')
            return new File([buffer], `reference-${idx}.png`, { type: 'image/png' })
          })
        : null

    // Fire one request per image slot in parallel. Each slot streams its own
    // partial frames to the renderer and resolves to a final image, so the UI
    // fills in progressively instead of waiting for the whole batch.
    const results = await Promise.allSettled(
      Array.from({ length: n }, (_, index) =>
        generateOneSlot({
          index,
          prompt: fullPrompt,
          model,
          size,
          quality,
          imageFiles,
          apiKey,
          emit,
          signal: controller.signal,
        })
      )
    )

    const images = results
      .filter((r) => r.status === 'fulfilled')
      .map((r) => r.value)

    // Persist any image that finished before a stop (don't waste paid results).
    const imageIds = images.map(saveImageFile)
    const canceled = controller.signal.aborted

    if (images.length === 0) {
      if (canceled) return { success: false, canceled: true }
      const firstErr = results.find((r) => r.status === 'rejected')
      throw firstErr ? firstErr.reason : new Error('Không tạo được ảnh nào.')
    }

    // Reference images persist so they survive restarts. On a regenerate the
    // references are already on disk, so the caller passes persistReferences:
    // false to avoid saving duplicate copies.
    const referenceImageIds =
      referenceImages && persistReferences !== false
        ? referenceImages.map((img) => saveImageFile(img.data))
        : []

    return { success: true, imageIds, referenceImageIds, canceled }
  } catch (err) {
    console.error(err)
    return { success: false, error: err.message || String(err) }
  } finally {
    if (requestId) activeGenerations.delete(requestId)
  }
})

// Stop an in-flight generation: abort its network calls. Any images already
// completed are still returned by the generate handler above.
ipcMain.handle('image:cancel', (_event, requestId) => {
  const controller = activeGenerations.get(requestId)
  if (controller) {
    controller.abort()
    return true
  }
  return false
})

// ---- Sheet batch gen (1.2.0) ----
// Đọc Google Sheet "queue" qua Apps Script → ghép kernel + slot → gen 1024/medium
// bằng pipeline gpt-image sẵn có → lưu ảnh → ghi ngược status + image_path vào sheet.
// Dòng có `line` và `status` trống được coi là hàng chờ gen; chạy lại không gen trùng.
function kernelsDir() {
  return path.join(app.getPath('userData'), 'kernels')
}

// Ghép khối kernel bất biến với các trường slot của một concept. Thuần chuỗi,
// không tốn token LLM — chỉ nối kernel + các trường có giá trị.
function buildSheetPrompt(line, slot) {
  const kernel = fs.readFileSync(path.join(kernelsDir(), `${line}-kernel.md`), 'utf-8')
  const fields = [
    'recipient_text',
    'year_text',
    'ceramic_shape',
    'raised_hologram_motif',
    'flat_artwork',
    'palette',
  ]
  const body = fields
    .filter((k) => slot[k])
    .map((k) => `${k}: ${slot[k]}`)
    .join('\n')
  return `${kernel}\n\n## THIS CONCEPT\n${body}`
}

// Emit tiến trình batch cho renderer (số dòng đã xử lý / tổng, và lỗi từng dòng).
function emitSheetProgress(payload) {
  if (win && !win.isDestroyed()) {
    win.webContents.send('sheet:batch:progress', payload)
  }
}

ipcMain.handle('sheet:batch', async () => {
  const url = store.get('appsScriptUrl', '').trim()
  const secret = store.get('appsScriptSecret', '')
  const apiKey = store.get('apiKey', '')
  if (!url) return { ok: false, error: 'Chưa cấu hình Apps Script URL trong Cài đặt.' }
  if (!apiKey) return { ok: false, error: 'Chưa cấu hình OpenAI API key trong Cài đặt.' }
  const model = store.get('model', 'gpt-image-1')

  // Ghi ngược status + image_path cho một dòng. Dùng GET query param (không phải
  // POST body) vì Apps Script 302-redirect làm rơi body của POST. Không chặn vòng
  // lặp nếu lỗi mạng.
  const update = (row, status, image_path) => {
    const qs =
      `?secret=${encodeURIComponent(secret)}&action=update&row=${row}` +
      `&status=${encodeURIComponent(status)}&image_path=${encodeURIComponent(image_path)}`
    return fetch(url + qs).catch(() => {})
  }

  try {
    // 1) Lấy các dòng chờ gen.
    const listRes = await fetch(`${url}?secret=${encodeURIComponent(secret)}&action=pending`)
    const list = await listRes.json()
    if (!list.ok) throw new Error(list.error || 'Không đọc được sheet.')

    const rows = Array.isArray(list.rows) ? list.rows : []
    emitSheetProgress({ status: 'start', total: rows.length })

    let done = 0
    for (let i = 0; i < rows.length; i++) {
      const slot = rows[i]
      try {
        const prompt = buildSheetPrompt(slot.line, slot)
        // Tái dùng đúng pipeline gen của app (streaming + fallback). size/quality
        // khóa cứng theo output-image-spec: 1024/medium, PNG, không upscale.
        const b64 = await generateOneSlot({
          index: 0,
          prompt,
          model,
          size: '1024x1024',
          quality: 'medium',
          imageFiles: null,
          apiKey,
          emit: () => {},
          signal: new AbortController().signal,
        })
        const id = saveImageFile(b64)
        await update(slot._row, 'done', imagePath(id))
        done++
        emitSheetProgress({ status: 'progress', done, total: rows.length, row: slot._row })
      } catch (e) {
        await update(slot._row, `error: ${String(e.message || e).slice(0, 150)}`, '')
        emitSheetProgress({ status: 'error', row: slot._row, message: String(e.message || e) })
      }
    }
    emitSheetProgress({ status: 'done', generated: done, total: rows.length })
    return { ok: true, generated: done, total: rows.length }
  } catch (e) {
    return { ok: false, error: String(e.message || e) }
  }
})

// ---- Conversation (tab) management ----
ipcMain.handle('conversations:list', () => ensureIndex())

ipcMain.handle('conversations:create', (_event, payload = {}) => {
  const idx = ensureIndex()
  const id = randomUUID()
  const conv = {
    id,
    title: payload.title || `Cuộc trò chuyện ${idx.list.length + 1}`,
    createdAt: Date.now(),
  }
  // A conversation opened from a bot remembers it, so generation uses the
  // bot's instructions instead of the global ones.
  if (payload.botId) conv.botId = payload.botId
  idx.list.push(conv)
  idx.activeId = id
  writeConversation(id, [])
  writeIndex(idx)
  return conv
})

ipcMain.handle('conversations:rename', (_event, { id, title }) => {
  const idx = ensureIndex()
  const conv = idx.list.find((c) => c.id === id)
  if (conv) {
    conv.title = (title || '').trim() || conv.title
    writeIndex(idx)
  }
  return true
})

ipcMain.handle('conversations:setActive', (_event, id) => {
  const idx = ensureIndex()
  if (idx.list.some((c) => c.id === id)) {
    idx.activeId = id
    writeIndex(idx)
  }
  return true
})

// Delete a conversation along with the images it owns, then return the
// updated index. Always keeps at least one conversation around.
ipcMain.handle('conversations:delete', (_event, id) => {
  const idx = ensureIndex()
  for (const m of readConversation(id)) {
    for (const imgId of m.imageIds || []) {
      try {
        fs.rmSync(imagePath(imgId))
      } catch {
        // image already gone
      }
    }
  }
  try {
    fs.rmSync(convPath(id))
  } catch {
    // file already gone
  }

  idx.list = idx.list.filter((c) => c.id !== id)
  if (idx.list.length === 0) {
    const newId = randomUUID()
    idx.list = [{ id: newId, title: 'Cuộc trò chuyện 1', createdAt: Date.now() }]
    idx.activeId = newId
    writeConversation(newId, [])
  } else if (idx.activeId === id) {
    idx.activeId = idx.list[0].id
  }
  writeIndex(idx)
  return idx
})

// ---- Bot management ----
ipcMain.handle('bots:list', () => readBots())

ipcMain.handle('bots:create', (_event, { name, instructions }) => {
  const bots = readBots()
  const bot = {
    id: randomUUID(),
    name: (name || '').trim() || 'Bot mới',
    instructions: instructions || '',
    createdAt: Date.now(),
  }
  bots.push(bot)
  writeBots(bots)
  return bot
})

ipcMain.handle('bots:update', (_event, { id, name, instructions }) => {
  const bots = readBots()
  const bot = bots.find((b) => b.id === id)
  if (!bot) return null
  if (name !== undefined) bot.name = name.trim() || bot.name
  if (instructions !== undefined) bot.instructions = instructions
  writeBots(bots)
  return bot
})

ipcMain.handle('bots:delete', (_event, id) => {
  const bots = readBots().filter((b) => b.id !== id)
  writeBots(bots)
  return bots
})

ipcMain.handle('conversation:get', (_event, id) => readConversation(id))

ipcMain.handle('conversation:save', (_event, { id, messages }) => {
  writeConversation(id, Array.isArray(messages) ? messages : [])
  return true
})

// Read a stored image back as base64 (used to re-attach it as a reference).
ipcMain.handle('image:read', (_event, id) => {
  try {
    return fs.readFileSync(imagePath(id)).toString('base64')
  } catch {
    return null
  }
})

// ---- Export a stored image to a user-chosen location ----
ipcMain.handle('image:save', async (_event, { id, defaultName }) => {
  const result = await dialog.showSaveDialog(win, {
    defaultPath: defaultName || 'image.png',
    filters: [{ name: 'PNG Image', extensions: ['png'] }],
  })

  if (result.canceled || !result.filePath) {
    return { success: false }
  }

  fs.copyFileSync(imagePath(id), result.filePath)
  return { success: true, path: result.filePath }
})

// ---- Image storage folder: inspect, open, and relocate ----
ipcMain.handle('images:getFolder', () => getImagesDir())

// Open the folder that stores all generated images in the OS file manager.
ipcMain.handle('images:openFolder', async () => {
  const dir = getImagesDir()
  fs.mkdirSync(dir, { recursive: true })
  const err = await shell.openPath(dir)
  return { success: !err, path: dir, error: err || undefined }
})

// Let the user pick a new storage folder, move existing images into it, then
// remember the choice. Image ids are bare filenames, so nothing else changes.
ipcMain.handle('images:chooseFolder', async () => {
  const result = await dialog.showOpenDialog(win, {
    title: 'Chọn thư mục lưu ảnh',
    properties: ['openDirectory', 'createDirectory'],
  })
  if (result.canceled || !result.filePaths?.[0]) return { success: false }

  const target = result.filePaths[0]
  const current = getImagesDir()
  if (path.resolve(target) === path.resolve(current)) {
    return { success: true, path: current, moved: 0 }
  }

  fs.mkdirSync(target, { recursive: true })
  let moved = 0
  try {
    for (const name of fs.readdirSync(current)) {
      const from = path.join(current, name)
      const to = path.join(target, name)
      try {
        if (!fs.statSync(from).isFile()) continue
        try {
          fs.renameSync(from, to) // fast path, same volume
        } catch {
          fs.copyFileSync(from, to) // cross-volume fallback
          fs.rmSync(from)
        }
        moved++
      } catch {
        // skip a file we couldn't move; keep going
      }
    }
  } catch {
    // current folder may not exist yet — nothing to move
  }

  store.set('imagesDir', target)
  return { success: true, path: target, moved }
})