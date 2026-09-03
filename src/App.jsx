import React, { useEffect, useRef, useState } from 'react'
import SettingsModal from './components/SettingsModal.jsx'
import ChatMessage from './components/ChatMessage.jsx'
import Composer from './components/Composer.jsx'
import Lightbox from './components/Lightbox.jsx'
import ConversationTabs from './components/ConversationTabs.jsx'
import Sidebar from './components/Sidebar.jsx'
import BotModal from './components/BotModal.jsx'

// Stored images are served from disk via the media:// protocol (see electron/main.js).
const mediaUrl = (id) => `media://img/${id}`

// Strip transient/in-memory fields (data URLs, pending flags) before persisting.
// Generation params (count/size/quality) are kept on user messages so a turn
// can later be edited and regenerated with the same settings.
function toPersisted(messages) {
  return messages
    .filter((m) => !m.pending)
    .map((m) => ({
      id: m.id,
      role: m.role,
      text: m.text,
      imageIds: m.imageIds,
      count: m.count,
      size: m.size,
      quality: m.quality,
    }))
}

// Rehydrate a conversation loaded from disk: rebuild displayable image URLs
// from the persisted image ids.
function fromPersisted(items) {
  return (items || []).map((m) => ({
    ...m,
    images: m.imageIds ? m.imageIds.map(mediaUrl) : undefined,
  }))
}

// How many prior user prompts to carry forward as context. The Images API is
// stateless, so to make follow-ups like "do the same with these images" work we
// prepend the recent text instructions ourselves. Capped to keep the prompt
// focused (too much history degrades image quality).
const CONTEXT_PROMPTS = 6

// Build the prompt actually sent to the API: the prior user instructions in
// this conversation followed by the current one. Returns the raw prompt
// unchanged when there's no prior context.
function buildContextPrompt(priorMessages, currentPrompt) {
  const priorPrompts = (priorMessages || [])
    .filter((m) => m.role === 'user' && m.text && m.text.trim())
    .map((m) => m.text.trim())
    .slice(-CONTEXT_PROMPTS)
  if (priorPrompts.length === 0) return currentPrompt
  const context = priorPrompts.map((p, i) => `${i + 1}. ${p}`).join('\n')
  return (
    `Bối cảnh các yêu cầu trước đó trong cuộc trò chuyện (để hiểu các tham chiếu như "làm tương tự", "như trên"):\n${context}\n\n` +
    `Yêu cầu hiện tại: ${currentPrompt}`
  )
}

export default function App() {
  const [conversations, setConversations] = useState([])
  const [activeId, setActiveId] = useState(null)
  // Map of conversationId -> in-memory messages (lazy-loaded per tab).
  const [convMessages, setConvMessages] = useState({})
  const [isSettingsOpen, setSettingsOpen] = useState(false)
  const [hasApiKey, setHasApiKey] = useState(true)
  // User-defined bots and the sidebar that lists them. `botModal` holds the
  // bot being created/edited (null when closed; {} when creating).
  const [bots, setBots] = useState([])
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [botModal, setBotModal] = useState(null)
  // Conversations with a generation in flight. Per-conversation so other tabs
  // stay usable while one is busy — letting several generate concurrently.
  const [generatingIds, setGeneratingIds] = useState(() => new Set())
  const [attachments, setAttachments] = useState([])
  const [lightbox, setLightbox] = useState(null)
  // Sheet Batch Gen (1.2.0): a global queue run. `running` disables the button,
  // `text` shows live progress from the sheet:batch:progress channel.
  const [sheetBatch, setSheetBatch] = useState({ running: false, text: '' })
  const scrollRef = useRef(null)
  // In-flight generations keyed by requestId -> { convId, assistantId }, so
  // streamed frames from concurrent requests reach the right message slot.
  const inFlight = useRef(new Map())

  const messages = convMessages[activeId] || []
  const isActiveGenerating = generatingIds.has(activeId)

  useEffect(() => {
    window.api.getSettings().then((settings) => {
      if (!settings.apiKey) {
        setHasApiKey(false)
        setSettingsOpen(true)
      }
    })
  }, [])

  // Load the conversation list and open the previously active tab on startup.
  useEffect(() => {
    window.api.listConversations().then((idx) => {
      setConversations(idx.list)
      setActiveId(idx.activeId)
      loadConversation(idx.activeId)
    })
    window.api.listBots().then(setBots)
  }, [])

  // Fetch a conversation's messages from disk the first time it's opened.
  async function loadConversation(id) {
    if (!id) return
    let alreadyLoaded = false
    setConvMessages((prev) => {
      alreadyLoaded = prev[id] !== undefined
      return prev
    })
    if (alreadyLoaded) return
    const items = await window.api.getConversation(id)
    setConvMessages((prev) =>
      prev[id] !== undefined ? prev : { ...prev, [id]: fromPersisted(items) }
    )
  }

  // Live partial/final frames for the in-flight generation: fill slots as they
  // stream in, targeting the conversation that owns the request.
  useEffect(() => {
    return window.api.onImageProgress(({ requestId, index, b64 }) => {
      const f = inFlight.current.get(requestId)
      if (!f) return
      const src = `data:image/png;base64,${b64}`
      setConvMessages((prev) => {
        const msgs = prev[f.convId]
        if (!msgs) return prev
        const updated = msgs.map((m) => {
          if (m.id !== f.assistantId) return m
          const images = [...m.images]
          images[index] = src
          return { ...m, images }
        })
        return { ...prev, [f.convId]: updated }
      })
    })
  }, [])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, isActiveGenerating])

  // The instructions appended to a conversation's prompts: a bot conversation
  // uses the bot's own instructions; everything else falls back to the global
  // setting (signalled by returning undefined).
  function effectiveInstructions(convId) {
    const conv = conversations.find((c) => c.id === convId)
    if (!conv?.botId) return undefined
    const bot = bots.find((b) => b.id === conv.botId)
    return bot ? bot.instructions || '' : undefined
  }

  // Shared generation core for both a fresh send and an edit/regenerate. The
  // caller has already placed the user message and a pending assistant slot;
  // this fires the request, streams results into `assistantId`, and persists.
  async function runGeneration({ convId, userId, assistantId, apiPrompt, images, count, size, quality, persistReferences = true }) {
    const requestId = crypto.randomUUID()
    inFlight.current.set(requestId, { convId, assistantId })
    setGeneratingIds((prev) => new Set(prev).add(convId))

    const result = await window.api.generateImages({
      prompt: apiPrompt,
      n: count,
      size,
      quality,
      referenceImages: images,
      persistReferences,
      instructionsOverride: effectiveInstructions(convId),
      requestId,
    })

    inFlight.current.delete(requestId)
    setGeneratingIds((prev) => {
      const next = new Set(prev)
      next.delete(convId)
      return next
    })

    setConvMessages((prev) => {
      const next = (prev[convId] || []).map((m) => {
        if (m.id === assistantId) {
          if (result.success) {
            return {
              id: assistantId,
              role: 'assistant',
              images: result.imageIds.map(mediaUrl),
              imageIds: result.imageIds,
            }
          }
          if (result.canceled) {
            return { id: assistantId, role: 'error', text: 'Đã dừng tạo ảnh.' }
          }
          return { id: assistantId, role: 'error', text: result.error }
        }
        // Swap the user's reference previews for their persisted copies.
        if (m.id === userId && result.success && result.referenceImageIds?.length) {
          return {
            ...m,
            images: result.referenceImageIds.map(mediaUrl),
            imageIds: result.referenceImageIds,
          }
        }
        return m
      })
      window.api.saveConversation({ id: convId, messages: toPersisted(next) })
      return { ...prev, [convId]: next }
    })
  }

  async function handleSend({ prompt, images, count, size, quality }) {
    const convId = activeId
    const userId = crypto.randomUUID()
    const assistantId = crypto.randomUUID()
    const userMessage = {
      id: userId,
      role: 'user',
      text: prompt,
      images: images.map((img) => `data:image/png;base64,${img.data}`),
      // Remembered so this turn can be edited and regenerated later.
      count,
      size,
      quality,
    }

    // The Images API is stateless, so weave the conversation's prior text
    // instructions into the prompt we send (the displayed message keeps the
    // raw text the user typed).
    const apiPrompt = buildContextPrompt(convMessages[convId], prompt)

    // Auto-name an untouched conversation from its first prompt.
    const isFirstMessage = (convMessages[convId]?.length || 0) === 0
    if (isFirstMessage && prompt.trim()) {
      const title = prompt.trim().slice(0, 40)
      window.api.renameConversation({ id: convId, title })
      setConversations((prev) => prev.map((c) => (c.id === convId ? { ...c, title } : c)))
    }

    // Placeholder assistant message with empty slots that fill in as images stream.
    setConvMessages((prev) => ({
      ...prev,
      [convId]: [
        ...(prev[convId] || []),
        userMessage,
        { id: assistantId, role: 'assistant', images: Array(count).fill(null), pending: true },
      ],
    }))

    await runGeneration({ convId, userId, assistantId, apiPrompt, images, count, size, quality })
  }

  // Edit a previously sent prompt and regenerate that turn's images in place.
  async function handleEditMessage(userId, newText) {
    const convId = activeId
    const trimmed = (newText || '').trim()
    if (!trimmed || generatingIds.has(convId)) return

    const msgs = convMessages[convId] || []
    const userIdx = msgs.findIndex((m) => m.id === userId)
    if (userIdx === -1) return
    const userMsg = msgs[userIdx]

    // Reuse the same generation settings + reference images as the original
    // turn. The references already live on disk, so read them back to base64.
    const count = userMsg.count || msgs[userIdx + 1]?.images?.length || 1
    const size = userMsg.size || 'auto'
    const quality = userMsg.quality || 'auto'

    const images = []
    for (const id of userMsg.imageIds || []) {
      const b64 = await window.api.readImage(id)
      if (b64) images.push({ data: b64 })
    }

    // The message right after the prompt is its response — regenerate it in
    // place. If there isn't one, insert a fresh assistant slot after the prompt.
    const nextMsg = msgs[userIdx + 1]
    const hasResponse = nextMsg && nextMsg.role !== 'user'
    const assistantId = hasResponse ? nextMsg.id : crypto.randomUUID()

    const apiPrompt = buildContextPrompt(msgs.slice(0, userIdx), trimmed)

    // Apply the edited text and reset the response slot to pending.
    setConvMessages((prev) => {
      const cur = prev[convId] || []
      const edited = cur.map((m) => (m.id === userId ? { ...m, text: trimmed } : m))
      const placeholder = {
        id: assistantId,
        role: 'assistant',
        images: Array(count).fill(null),
        pending: true,
      }
      let result
      if (hasResponse) {
        result = edited.map((m) => (m.id === assistantId ? placeholder : m))
      } else {
        const i = edited.findIndex((m) => m.id === userId)
        result = [...edited.slice(0, i + 1), placeholder, ...edited.slice(i + 1)]
      }
      return { ...prev, [convId]: result }
    })

    await runGeneration({
      convId,
      userId,
      assistantId,
      apiPrompt,
      images,
      count,
      size,
      quality,
      persistReferences: false,
    })
  }

  // Stop the active conversation's in-flight generation. The generate promise
  // then resolves (canceled), and handleSend's continuation cleans up state.
  function handleStop() {
    for (const [reqId, f] of inFlight.current) {
      if (f.convId === activeId) window.api.cancelGeneration(reqId)
    }
  }

  // Run the Sheet Batch: read the queue, then generate each pending concept as a
  // turn in a NEW conversation so the user watches images appear (with streaming),
  // and write each result back to the sheet. Global — not tied to the active tab.
  async function handleSheetBatch() {
    if (sheetBatch.running) return
    setSheetBatch({ running: true, text: 'Đang đọc sheet…' })

    const res = await window.api.fetchSheetPending()
    if (!res || !res.ok) {
      setSheetBatch({ running: false, text: '' })
      window.alert(res?.error || 'Không đọc được sheet.')
      return
    }
    const rows = res.rows || []
    if (rows.length === 0) {
      setSheetBatch({ running: false, text: 'Không có dòng nào đang chờ gen.' })
      return
    }

    // A fresh conversation to hold this batch's results.
    const stamp = new Date().toLocaleString()
    const conv = await window.api.createConversation({ title: `Sheet Batch · ${stamp}` })
    setConversations((prev) => [...prev, conv])
    setConvMessages((prev) => ({ ...prev, [conv.id]: [] }))
    setActiveId(conv.id)

    let done = 0
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      setSheetBatch({ running: true, text: `Đang gen ${i + 1}/${rows.length}…` })

      const userId = crypto.randomUUID()
      const assistantId = crypto.randomUUID()
      // A readable label for the concept (what the user "asked for").
      const label = [row.line, row.recipient_text, row.year_text, row.ceramic_shape]
        .filter(Boolean)
        .join(' · ')

      // Place the concept + a pending image slot into the conversation.
      setConvMessages((prev) => ({
        ...prev,
        [conv.id]: [
          ...(prev[conv.id] || []),
          { id: userId, role: 'user', text: label || row.line },
          { id: assistantId, role: 'assistant', images: [null], pending: true },
        ],
      }))

      // Kernel missing (or other prep error) — mark and skip, keep going.
      if (row._error || !row._prompt) {
        setConvMessages((prev) => ({
          ...prev,
          [conv.id]: (prev[conv.id] || []).map((m) =>
            m.id === assistantId ? { id: assistantId, role: 'error', text: row._error || 'Thiếu prompt.' } : m
          ),
        }))
        await window.api.markSheetError({ row: row._row, message: row._error || 'no prompt' })
        continue
      }

      // Reuse the app's generation pipeline. Registering in inFlight lets the
      // existing onImageProgress handler stream partial frames into this slot,
      // so the image builds up live just like a normal generation.
      const requestId = crypto.randomUUID()
      inFlight.current.set(requestId, { convId: conv.id, assistantId })

      const result = await window.api.generateImages({
        prompt: row._prompt,
        n: 1,
        size: '1024x1024',
        quality: 'medium',
        referenceImages: [],
        persistReferences: false,
        instructionsOverride: '', // kernel is the full brief; don't append global instructions
        requestId,
      })

      inFlight.current.delete(requestId)

      // Read the image id straight from the result — NOT inside the setState
      // updater below, which React may run asynchronously (that timing bug made
      // the sheet report "gen failed" even when the image was produced fine).
      const okImageId = result.success ? result.imageIds && result.imageIds[0] : null

      // Finalize the slot and persist; write the outcome back to the sheet.
      setConvMessages((prev) => {
        const next = (prev[conv.id] || []).map((m) => {
          if (m.id !== assistantId) return m
          if (result.success && okImageId) {
            return {
              id: assistantId,
              role: 'assistant',
              images: result.imageIds.map(mediaUrl),
              imageIds: result.imageIds,
            }
          }
          return { id: assistantId, role: 'error', text: result.error || 'Lỗi tạo ảnh.' }
        })
        window.api.saveConversation({ id: conv.id, messages: toPersisted(next) })
        return { ...prev, [conv.id]: next }
      })

      if (result.success && okImageId) {
        await window.api.markSheetDone({ row: row._row, imageId: okImageId })
        done++
      } else {
        await window.api.markSheetError({ row: row._row, message: result.error || 'gen failed' })
      }
    }

    setSheetBatch({ running: false, text: `Xong: đã gen ${done}/${rows.length} ảnh.` })
  }

  function handleSelectTab(id) {
    if (id === activeId) return
    setActiveId(id)
    window.api.setActiveConversation(id)
    loadConversation(id)
  }

  async function handleNewTab() {
    const conv = await window.api.createConversation()
    setConversations((prev) => [...prev, conv])
    setConvMessages((prev) => ({ ...prev, [conv.id]: [] }))
    setActiveId(conv.id)
  }

  // ---- Bots ----
  // Open a bot: spin up a fresh tab bound to it, so generation there uses the
  // bot's own instructions instead of the global ones.
  async function handleOpenBot(bot) {
    const conv = await window.api.createConversation({ botId: bot.id, title: bot.name })
    setConversations((prev) => [...prev, conv])
    setConvMessages((prev) => ({ ...prev, [conv.id]: [] }))
    setActiveId(conv.id)
  }

  async function handleSaveBot({ name, instructions }) {
    if (botModal?.id) {
      const updated = await window.api.updateBot({ id: botModal.id, name, instructions })
      setBots((prev) => prev.map((b) => (b.id === updated.id ? updated : b)))
    } else {
      const created = await window.api.createBot({ name, instructions })
      setBots((prev) => [...prev, created])
    }
    setBotModal(null)
  }

  async function handleDeleteBot(bot) {
    if (!window.confirm(`Xóa bot "${bot.name}"? Các cuộc trò chuyện đã mở vẫn được giữ lại.`)) {
      return
    }
    const list = await window.api.deleteBot(bot.id)
    setBots(list)
  }

  async function handleCloseTab(id) {
    const conv = conversations.find((c) => c.id === id)
    if (!window.confirm(`Đóng và xóa "${conv?.title ?? 'cuộc trò chuyện'}"? Ảnh đã tạo trong cuộc trò chuyện này cũng sẽ bị xóa.`)) {
      return
    }
    const idx = await window.api.deleteConversation(id)
    setConversations(idx.list)
    setConvMessages((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    setActiveId(idx.activeId)
    loadConversation(idx.activeId)
  }

  function handleRenameTab(id, title) {
    const trimmed = (title || '').trim()
    if (!trimmed) return
    window.api.renameConversation({ id, title: trimmed })
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title: trimmed } : c)))
  }

  async function handleSaveSettings(settings) {
    await window.api.saveSettings(settings)
    setHasApiKey(true)
    setSettingsOpen(false)
  }

  function handleImageClick(images, imageIds, index) {
    setLightbox({ images, imageIds, index })
  }

  // The id of the image currently shown in the lightbox (it tracks the index as
  // the user arrows between a generation's images).
  const lightboxId = lightbox?.imageIds?.[lightbox.index]

  async function handleUseForEdit() {
    if (lightboxId) {
      const b64 = await window.api.readImage(lightboxId)
      if (b64) {
        setAttachments((prev) => [
          ...prev,
          { data: b64, preview: `data:image/png;base64,${b64}` },
        ])
      }
    }
    setLightbox(null)
  }

  async function handleSaveLightbox() {
    if (lightboxId) {
      await window.api.saveImage({ id: lightboxId, defaultName: buildDownloadName() })
    }
  }

  // A friendly, sortable default filename for downloads:
  // "<conversation title>_<YYYY-MM-DD_HH-mm-ss>[_<n>].png" — the title makes it
  // recognizable, the timestamp keeps files ordered, and the index disambiguates
  // images from the same generation.
  function buildDownloadName() {
    const pad = (n) => String(n).padStart(2, '0')
    const d = new Date()
    const stamp =
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
      `_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
    const rawTitle = activeConv?.title?.trim() || 'ChatDKH'
    const title = rawTitle.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '_').slice(0, 50) || 'ChatDKH'
    const total = lightbox?.images?.length || 1
    const suffix = total > 1 ? `_${(lightbox.index || 0) + 1}` : ''
    return `${title}_${stamp}${suffix}.png`
  }

  const activeConv = conversations.find((c) => c.id === activeId)
  const activeBot = activeConv?.botId ? bots.find((b) => b.id === activeConv.botId) : null

  return (
    <div className="app">
      <header
        className="topbar"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
      >
        <div className="topbar-title">ChatDKH</div>
        <div
          className="topbar-actions"
          style={{ display: 'flex', alignItems: 'center', gap: 12 }}
        >
          {sheetBatch.text && (
            <span className="topbar-status" style={{ fontSize: 13, opacity: 0.7 }}>
              {sheetBatch.text}
            </span>
          )}
          <button
            type="button"
            className="btn secondary"
            onClick={handleSheetBatch}
            disabled={sheetBatch.running}
            title="Đọc Google Sheet queue và tạo ảnh cho các dòng đang chờ"
          >
            {sheetBatch.running ? '⏳ Đang gen…' : '🔄 Đồng bộ & Gen'}
          </button>
        </div>
      </header>

      <div className="app-body">
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((v) => !v)}
          bots={bots}
          onOpenBot={handleOpenBot}
          onAddBot={() => setBotModal({})}
          onEditBot={(bot) => setBotModal(bot)}
          onDeleteBot={handleDeleteBot}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        <div className="main-col">
          <ConversationTabs
            conversations={conversations}
            activeId={activeId}
            generatingIds={generatingIds}
            onSelect={handleSelectTab}
            onNew={handleNewTab}
            onClose={handleCloseTab}
            onRename={handleRenameTab}
          />

          <main className="chat-area" ref={scrollRef}>
            {/* Keyed by activeId so switching tabs remounts and replays the fade. */}
            <div className="chat-inner" key={activeId}>
              {messages.length === 0 && (
                <div className="empty-state">
                  {activeBot ? (
                    <>
                      <p>🤖 Bot: <strong>{activeBot.name}</strong></p>
                      <p>Cuộc trò chuyện này dùng Instructions riêng của bot.</p>
                    </>
                  ) : (
                    <>
                      <p>Nhập prompt để tạo ảnh.</p>
                      <p>Bạn có thể paste ảnh tham chiếu vào ô nhập (Ctrl+V).</p>
                    </>
                  )}
                </div>
              )}
              {messages.map((msg) => (
                <ChatMessage
                  key={msg.id}
                  message={msg}
                  onImageClick={handleImageClick}
                  onEdit={handleEditMessage}
                  editDisabled={isActiveGenerating}
                />
              ))}
            </div>
          </main>

          <Composer
            onSend={handleSend}
            onStop={handleStop}
            disabled={isActiveGenerating}
            attachments={attachments}
            setAttachments={setAttachments}
          />
        </div>
      </div>

      {lightbox && (
        <Lightbox
          image={lightbox}
          onClose={() => setLightbox(null)}
          onNavigate={(index) => setLightbox((lb) => ({ ...lb, index }))}
          onSave={lightboxId ? handleSaveLightbox : null}
          onUseForEdit={lightboxId ? handleUseForEdit : null}
        />
      )}

      {isSettingsOpen && (
        <SettingsModal
          onSave={handleSaveSettings}
          onClose={() => hasApiKey && setSettingsOpen(false)}
          dismissible={hasApiKey}
        />
      )}

      {botModal && (
        <BotModal
          bot={botModal.id ? botModal : null}
          onSave={handleSaveBot}
          onClose={() => setBotModal(null)}
        />
      )}
    </div>
  )
}