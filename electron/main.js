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
    // Model viết chữ (nhìn ảnh + wiki). Tách riêng vì `model` là model ảnh.
    textModel: store.get('textModel', 'gpt-4.1'),
    customInstructions: store.get('customInstructions', ''),
    appsScriptUrl: store.get('appsScriptUrl', ''),
    appsScriptSecret: store.get('appsScriptSecret', ''),
  }
})

ipcMain.handle(
  'settings:save',
  (_event, { apiKey, baseURL, model, textModel, customInstructions, appsScriptUrl, appsScriptSecret }) => {
    store.set('apiKey', apiKey)
    store.set('baseURL', baseURL)
    store.set('model', model)
    if (textModel !== undefined) store.set('textModel', textModel || 'gpt-4.1')
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
// Main chỉ lo I/O sheet + ghép prompt từ kernel. Việc gen + hiển thị do renderer
// điều phối (App.jsx) để tái dùng đúng luồng streaming của app: mỗi concept hiện
// thành một lượt trong một cuộc trò chuyện mới, ảnh chạy dần như gen thường.
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

function sheetConfig() {
  return {
    url: store.get('appsScriptUrl', '').trim(),
    secret: store.get('appsScriptSecret', ''),
  }
}

// Ghi ngược một dòng qua GET query param (Apps Script 302-redirect làm rơi body POST).
function sheetUpdate(row, status, image_path) {
  const { url, secret } = sheetConfig()
  if (!url) return Promise.resolve()
  const qs =
    `?secret=${encodeURIComponent(secret)}&action=update&row=${row}` +
    `&status=${encodeURIComponent(status)}&image_path=${encodeURIComponent(image_path || '')}`
  return fetch(url + qs).catch(() => {})
}

// Lấy các dòng chờ gen, kèm prompt đã ghép sẵn cho từng dòng (hoặc lỗi nếu thiếu kernel).
ipcMain.handle('sheet:fetchPending', async () => {
  const { url, secret } = sheetConfig()
  if (!url) return { ok: false, error: 'Chưa cấu hình Apps Script URL trong Cài đặt.' }
  if (!store.get('apiKey', '')) return { ok: false, error: 'Chưa cấu hình OpenAI API key trong Cài đặt.' }
  try {
    const res = await fetch(`${url}?secret=${encodeURIComponent(secret)}&action=pending`)
    const data = await res.json()
    if (!data.ok) throw new Error(data.error || 'Không đọc được sheet.')
    const rows = (Array.isArray(data.rows) ? data.rows : []).map((r) => {
      let prompt = null
      let error = null
      try {
        prompt = buildSheetPrompt(r.line, r)
      } catch {
        error = `Không đọc được kernel cho "${r.line}" (thiếu file ${r.line}-kernel.md?)`
      }
      return { ...r, _prompt: prompt, _error: error }
    })
    return { ok: true, rows }
  } catch (e) {
    return { ok: false, error: String(e.message || e) }
  }
})

// Đánh dấu một dòng đã gen xong: status=done + image_path (đường dẫn file thật).
ipcMain.handle('sheet:markDone', async (_event, { row, imageId }) => {
  await sheetUpdate(row, 'done', imageId ? imagePath(imageId) : '')
  return { ok: true }
})

// Đánh dấu một dòng lỗi.
ipcMain.handle('sheet:markError', async (_event, { row, message }) => {
  await sheetUpdate(row, `error: ${String(message || '').slice(0, 150)}`, '')
  return { ok: true }
})

// ---- Mockup set (1.3.0) ----
// Đọc mockup-shots.md (dùng chung mọi sản phẩm): preamble + danh sách shot.
// Renderer dùng ảnh đã duyệt làm reference rồi lặp gen từng shot.
ipcMain.handle('mockup:getShots', () => {
  try {
    const raw = fs.readFileSync(path.join(kernelsDir(), 'mockup-shots.md'), 'utf-8')
    const parts = raw.split('## SHOTS')
    const preamble = ((parts[0] || '').split('## PREAMBLE')[1] || '').trim()
    const shots = (parts[1] || '')
      .split('\n')
      .filter((l) => l.trim().startsWith('- '))
      .map((l) => {
        const seg = l.replace(/^\s*-\s*/, '').split(' | ')
        return { name: (seg[0] || '').trim(), text: seg.slice(1).join(' | ').trim() }
      })
      .filter((s) => s.name && s.text)
    if (!preamble || shots.length === 0) throw new Error('mockup-shots.md sai định dạng')
    return { ok: true, preamble, shots }
  } catch (e) {
    return { ok: false, error: `Không đọc được mockup-shots.md (đặt trong kernels/). ${String(e.message || e)}` }
  }
})

// ---- Listing writer (1.4.0) ----
// "Wiki" = một thư mục markdown do người dùng trỏ tới (mặc định userData/wiki,
// nhưng thường là một vault Obsidian có sẵn). Vault thật có thể vài MB / hàng
// trăm file, nên KHÔNG nuốt cả thư mục: người dùng tick chọn đúng những file
// làm luật viết listing, lựa chọn đó lưu trong config. Các file được chọn nối
// thành MỘT khối kiến thức đặt vào system message; ảnh đã duyệt gửi kèm dưới
// dạng image_url để model NHÌN sản phẩm thật thay vì mô tả lại prompt.
const DEFAULT_WIKI_DIR = path.join(app.getPath('userData'), 'wiki')

// Trên ngưỡng này mà chưa tick file nào thì bắt chọn, thay vì âm thầm gửi cả
// vault lên API (vừa đắt vừa loãng).
const WIKI_AUTO_LIMIT = 200_000

function wikiDir() {
  return store.get('wikiDir', DEFAULT_WIKI_DIR) || DEFAULT_WIKI_DIR
}

// Bản mẫu chỉ tạo cho thư mục wiki mặc định, và chỉ khi nó chưa tồn tại — không
// bao giờ ghi gì vào vault của người dùng.
const WIKI_TEMPLATE = `# WIKI — Chuẩn viết listing Etsy (bản mẫu, hãy sửa theo chuẩn của Dakuho)

## TITLE
- Tối đa 140 ký tự; những từ ĐẦU tiên quan trọng nhất (Etsy và Google cắt ở ~60 ký tự đầu).
- Mở đầu bằng cụm khách thật sự gõ (vd "Personalized Teacher Christmas Ornament"), không mở đầu bằng tên shop.
- Viết như một câu người đọc được, phân tách bằng " - " hoặc ","; KHÔNG nhồi từ khoá lặp lại.
- Ghép được các lớp: [sản phẩm] + [thuộc tính/chất liệu] + [dịp/người nhận] + [cá nhân hoá].

## TAGS
- Đúng 13 tag, mỗi tag TỐI ĐA 20 ký tự (kể cả dấu cách) — tag dài hơn sẽ bị bỏ.
- Ưu tiên cụm 2–3 từ (long-tail), không dùng tag 1 từ chung chung như "gift".
- Không lặp lại y hệt nhau; phủ nhiều góc: sản phẩm, dịp, người nhận, phong cách, chất liệu.
- Không dùng tên thương hiệu/nhân vật có bản quyền.

## DESCRIPTION
- ~160 ký tự đầu là đoạn Google/AI trích dẫn → nêu ngay sản phẩm là gì, cho ai, dịp nào.
- Sau đó: đoạn cảm xúc ngắn → gạch đầu dòng thông số (chất liệu, kích thước, cá nhân hoá) → hướng dẫn đặt hàng.
- Viết bằng tiếng Anh tự nhiên, giọng ấm áp, không hứa hẹn quá mức.

## CẤM
- Không bịa chất liệu, kích thước, thời gian giao hàng nếu wiki/bối cảnh không nêu.
- Không tuyên bố y tế, không so sánh với thương hiệu khác, không dùng tên nhân vật/logo có bản quyền.
`

function ensureWikiDir() {
  const dir = wikiDir()
  if (dir === DEFAULT_WIKI_DIR && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'etsy-listing-wiki.md'), WIKI_TEMPLATE)
  }
  return dir
}

// Thư mục rác của vault/repo — quét vào chỉ tốn thời gian.
const WIKI_SKIP_DIRS = new Set(['.obsidian', '.git', '.trash', 'node_modules', '.smart-env'])

// Quét đệ quy mọi .md, trả về đường dẫn tương đối + kích thước.
function scanWiki(dir) {
  const out = []
  const walk = (abs, rel) => {
    let entries
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const childRel = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        if (!WIKI_SKIP_DIRS.has(e.name)) walk(path.join(abs, e.name), childRel)
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
        let size = 0
        try {
          size = fs.statSync(path.join(abs, e.name)).size
        } catch {
          // file vừa bị xoá — bỏ qua
        }
        out.push({ rel: childRel, size })
      }
    }
  }
  walk(dir, '')
  return out.sort((a, b) => a.rel.localeCompare(b.rel))
}

// Chặn ../ thoát khỏi thư mục wiki khi đọc theo lựa chọn đã lưu.
function wikiFilePath(dir, rel) {
  const abs = path.resolve(dir, rel)
  const root = path.resolve(dir)
  if (abs !== root && !abs.startsWith(root + path.sep)) return null
  return abs
}

// Nối các file được chọn thành khối kiến thức. Không chọn gì thì lấy tất cả,
// nhưng chỉ khi tổng dung lượng còn nhỏ — vault lớn bắt buộc phải tick.
function readWiki() {
  const dir = ensureWikiDir()
  const all = scanWiki(dir)
  const selected = store.get('wikiFiles', [])
  const picked = selected.length > 0 ? all.filter((f) => selected.includes(f.rel)) : all

  if (picked.length === 0) {
    throw new Error(
      selected.length > 0
        ? 'Các file wiki đã chọn không còn tồn tại. Vào Cài đặt → chọn lại.'
        : `Không tìm thấy file .md nào trong ${dir}. Vào Cài đặt để chọn thư mục wiki.`
    )
  }

  const bytes = picked.reduce((s, f) => s + f.size, 0)
  if (selected.length === 0 && bytes > WIKI_AUTO_LIMIT) {
    throw new Error(
      `Thư mục wiki có ${all.length} file (${Math.round(bytes / 1024)} KB) — quá lớn để gửi hết. ` +
        `Vào Cài đặt → tick chọn những file cần dùng.`
    )
  }

  const parts = []
  const files = []
  for (const f of picked) {
    const abs = wikiFilePath(dir, f.rel)
    if (!abs) continue
    try {
      parts.push(`<!-- ${f.rel} -->\n${fs.readFileSync(abs, 'utf-8').trim()}`)
      files.push(f.rel)
    } catch {
      // file không đọc được — bỏ qua, phần còn lại vẫn dùng được
    }
  }
  return { dir, files, bytes, text: parts.join('\n\n---\n\n') }
}

const LISTING_SYSTEM = `Bạn là chuyên gia viết listing Etsy của Dakuho.

Bạn nhận MỘT ảnh sản phẩm đã được duyệt, phần bối cảnh của concept đó, và khối WIKI bên dưới.
WIKI là luật — mọi quy tắc về title/tag/description đều lấy từ đó.

Nguyên tắc bắt buộc:
- Chỉ mô tả những gì THỰC SỰ nhìn thấy trong ảnh (hình dạng, motif, màu, chữ trên sản phẩm).
  Ảnh mới là sự thật; bối cảnh chỉ để tham khảo khi hai bên lệch nhau.
- Không bịa chất liệu, kích thước, số lượng, thời gian giao hàng nếu WIKI hoặc bối cảnh không nêu.
- Nội dung listing viết bằng TIẾNG ANH.

Nếu WIKI quy định khuôn output riêng (vd title A/B, số ký tự bắt buộc, trường evidence),
hãy theo ĐÚNG khuôn của WIKI. Chỉ khi WIKI không quy định thì dùng khuôn mặc định sau,
không thêm lời dẫn, không dùng markdown heading:

TITLE
<một dòng>

TAGS
<đúng 13 tag, ngăn cách bằng dấu phẩy, mỗi tag tối đa 20 ký tự>

DESCRIPTION
<nhiều dòng>`

// Thông tin thư mục wiki cho phần Cài đặt.
// Danh sách mọi .md trong thư mục wiki + những file đang được tick chọn, để
// phần Cài đặt vẽ bảng chọn.
ipcMain.handle('wiki:info', () => {
  try {
    const dir = ensureWikiDir()
    const all = scanWiki(dir)
    const selected = store.get('wikiFiles', []).filter((rel) => all.some((f) => f.rel === rel))
    return { ok: true, dir, files: all, selected, autoLimit: WIKI_AUTO_LIMIT }
  } catch (e) {
    return { ok: false, error: String(e.message || e), dir: wikiDir(), files: [], selected: [] }
  }
})

// Trỏ wiki sang thư mục khác (thường là vault Obsidian có sẵn). Đổi thư mục thì
// xoá lựa chọn cũ vì đường dẫn tương đối không còn ý nghĩa.
ipcMain.handle('wiki:chooseFolder', async () => {
  const result = await dialog.showOpenDialog(win, {
    title: 'Chọn thư mục wiki (markdown)',
    properties: ['openDirectory'],
  })
  if (result.canceled || !result.filePaths?.[0]) return { ok: false }
  const target = result.filePaths[0]
  if (path.resolve(target) !== path.resolve(wikiDir())) {
    store.set('wikiDir', target)
    store.set('wikiFiles', [])
  }
  const all = scanWiki(target)
  return { ok: true, dir: target, files: all, selected: [], autoLimit: WIKI_AUTO_LIMIT }
})

// Lưu danh sách file được dùng làm luật viết listing.
ipcMain.handle('wiki:setSelection', (_event, files) => {
  store.set('wikiFiles', Array.isArray(files) ? files : [])
  return { ok: true }
})

ipcMain.handle('wiki:openFolder', async () => {
  const dir = ensureWikiDir()
  const err = await shell.openPath(dir)
  return { ok: !err, dir, error: err || undefined }
})

// Viết listing cho MỘT ảnh đã chọn: wiki + bối cảnh concept + chính tấm ảnh.
ipcMain.handle('listing:generate', async (_event, { imageId, context }) => {
  try {
    const apiKey = store.get('apiKey', '')
    if (!apiKey) throw new Error('Chưa cấu hình API key. Vui lòng vào Cài đặt.')

    const { text: wiki, files, bytes } = readWiki()
    if (!wiki.trim()) {
      throw new Error('Các file wiki được chọn đều rỗng. Vào Cài đặt để chọn lại.')
    }

    const b64 = fs.readFileSync(imagePath(imageId)).toString('base64')
    const model = store.get('textModel', 'gpt-4.1')

    const res = await fetchWithDuplex(`${endpointBase()}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: `${LISTING_SYSTEM}\n\n# WIKI\n${wiki}` },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text:
                  `Bối cảnh của concept này (có thể lệch với ảnh — ưu tiên ảnh):\n` +
                  `${(context || '').trim() || '(không có)'}\n\n` +
                  `Hãy viết listing cho đúng sản phẩm trong ảnh.`,
              },
              {
                type: 'image_url',
                image_url: { url: `data:image/png;base64,${b64}`, detail: 'high' },
              },
            ],
          },
        ],
      }),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`API ${res.status}: ${detail.slice(0, 300)}`)
    }
    const json = await res.json()
    const text = json?.choices?.[0]?.message?.content
    if (!text || !text.trim()) throw new Error('Phản hồi không chứa nội dung.')

    return { ok: true, text: text.trim(), model, wikiFiles: files, wikiBytes: bytes }
  } catch (e) {
    console.error(e)
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

// Xuất cả một bộ ảnh (vd 8 mockup) vào một thư mục con do người dùng chọn, đặt
// tên file theo thứ tự + tên shot để mở ra là biết ảnh nào đi slot nào.
function safeFileName(name, fallback) {
  const cleaned = String(name || '')
    .replace(/[\\/:*?"<>|]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
  return cleaned || fallback
}

ipcMain.handle('images:saveAll', async (_event, { items, folderName }) => {
  const list = Array.isArray(items) ? items.filter((it) => it && it.id) : []
  if (list.length === 0) return { success: false }

  const result = await dialog.showOpenDialog(win, {
    title: 'Chọn nơi lưu cả bộ ảnh',
    properties: ['openDirectory', 'createDirectory'],
  })
  if (result.canceled || !result.filePaths?.[0]) return { success: false }

  const target = path.join(result.filePaths[0], safeFileName(folderName, 'ChatDKH'))
  fs.mkdirSync(target, { recursive: true })

  let saved = 0
  const failed = []
  list.forEach((it, i) => {
    const order = String(i + 1).padStart(2, '0')
    const label = safeFileName(it.name, 'image')
    try {
      fs.copyFileSync(imagePath(it.id), path.join(target, `${order}-${label}.png`))
      saved++
    } catch {
      failed.push(it.name || it.id)
    }
  })

  return { success: true, path: target, saved, total: list.length, failed }
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
