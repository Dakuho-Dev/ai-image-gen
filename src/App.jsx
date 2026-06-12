import React, { useEffect, useRef, useState } from 'react'
import SettingsModal from './components/SettingsModal.jsx'
import ChatMessage from './components/ChatMessage.jsx'
import Composer from './components/Composer.jsx'
import Lightbox from './components/Lightbox.jsx'
import ConversationTabs from './components/ConversationTabs.jsx'

// Stored images are served from disk via the media:// protocol (see electron/main.js).
const mediaUrl = (id) => `media://img/${id}`

// Strip transient/in-memory fields (data URLs, pending flags) before persisting.
function toPersisted(messages) {
  return messages
    .filter((m) => !m.pending)
    .map((m) => ({ id: m.id, role: m.role, text: m.text, imageIds: m.imageIds }))
}

// Rehydrate a conversation loaded from disk: rebuild displayable image URLs
// from the persisted image ids.
function fromPersisted(items) {
  return (items || []).map((m) => ({
    ...m,
    images: m.imageIds ? m.imageIds.map(mediaUrl) : undefined,
  }))
}

export default function App() {
  const [conversations, setConversations] = useState([])
  const [activeId, setActiveId] = useState(null)
  // Map of conversationId -> in-memory messages (lazy-loaded per tab).
  const [convMessages, setConvMessages] = useState({})
  const [isSettingsOpen, setSettingsOpen] = useState(false)
  const [hasApiKey, setHasApiKey] = useState(true)
  const [isLoading, setIsLoading] = useState(false)
  const [attachments, setAttachments] = useState([])
  const [lightbox, setLightbox] = useState(null)
  const scrollRef = useRef(null)
  // The generation currently in flight: which conversation + assistant slot it fills.
  const inFlight = useRef(null)

  const messages = convMessages[activeId] || []

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
    return window.api.onImageProgress(({ index, b64 }) => {
      const f = inFlight.current
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
  }, [messages, isLoading])

  async function handleSend({ prompt, images, count, size, quality }) {
    const convId = activeId
    const userId = crypto.randomUUID()
    const assistantId = crypto.randomUUID()
    const userMessage = {
      id: userId,
      role: 'user',
      text: prompt,
      images: images.map((img) => `data:image/png;base64,${img.data}`),
    }

    // Auto-name an untouched conversation from its first prompt.
    const isFirstMessage = (convMessages[convId]?.length || 0) === 0
    if (isFirstMessage && prompt.trim()) {
      const title = prompt.trim().slice(0, 40)
      window.api.renameConversation({ id: convId, title })
      setConversations((prev) => prev.map((c) => (c.id === convId ? { ...c, title } : c)))
    }

    // Placeholder assistant message with empty slots that fill in as images stream.
    inFlight.current = { convId, assistantId }
    setConvMessages((prev) => ({
      ...prev,
      [convId]: [
        ...(prev[convId] || []),
        userMessage,
        { id: assistantId, role: 'assistant', images: Array(count).fill(null), pending: true },
      ],
    }))
    setIsLoading(true)

    const result = await window.api.generateImages({
      prompt,
      n: count,
      size,
      quality,
      referenceImages: images,
    })

    setIsLoading(false)
    inFlight.current = null

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

  function handleImageClick(src, id) {
    setLightbox({ src, id })
  }

  async function handleUseForEdit() {
    if (lightbox?.id) {
      const b64 = await window.api.readImage(lightbox.id)
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
    if (lightbox?.id) {
      await window.api.saveImage({ id: lightbox.id, defaultName: 'image.png' })
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-title">ChatDKH</div>
        <div className="topbar-actions">
          <button className="icon-btn" onClick={() => setSettingsOpen(true)} title="Cài đặt">
            ⚙
          </button>
        </div>
      </header>

      <ConversationTabs
        conversations={conversations}
        activeId={activeId}
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
              <p>Nhập prompt để tạo ảnh.</p>
              <p>Bạn có thể paste ảnh tham chiếu vào ô nhập (Ctrl+V).</p>
            </div>
          )}
          {messages.map((msg) => (
            <ChatMessage key={msg.id} message={msg} onImageClick={handleImageClick} />
          ))}
        </div>
      </main>

      <Composer
        onSend={handleSend}
        disabled={isLoading}
        attachments={attachments}
        setAttachments={setAttachments}
      />

      {lightbox && (
        <Lightbox
          image={lightbox}
          onClose={() => setLightbox(null)}
          onSave={lightbox.id ? handleSaveLightbox : null}
          onUseForEdit={lightbox.id ? handleUseForEdit : null}
        />
      )}

      {isSettingsOpen && (
        <SettingsModal
          onSave={handleSaveSettings}
          onClose={() => hasApiKey && setSettingsOpen(false)}
          dismissible={hasApiKey}
        />
      )}
    </div>
  )
}
