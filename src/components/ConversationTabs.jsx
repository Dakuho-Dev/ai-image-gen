import React, { useEffect, useRef, useState } from 'react'

// Horizontal, scrollable tab strip for switching between conversations.
// Double-click a tab to rename it inline; the × closes (deletes) it.
export default function ConversationTabs({
  conversations,
  activeId,
  onSelect,
  onNew,
  onClose,
  onRename,
}) {
  const [editingId, setEditingId] = useState(null)
  const [draft, setDraft] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingId])

  function startEdit(conv) {
    setEditingId(conv.id)
    setDraft(conv.title)
  }

  function commit() {
    if (editingId) {
      const title = draft.trim()
      if (title) onRename(editingId, title)
    }
    setEditingId(null)
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Escape') {
      setEditingId(null)
    }
  }

  return (
    <div className="tabbar">
      <div className="tabs">
        {conversations.map((conv) => {
          const isEditing = editingId === conv.id
          return (
            <div
              key={conv.id}
              className={`tab ${conv.id === activeId ? 'active' : ''}`}
              onClick={() => !isEditing && onSelect(conv.id)}
              onDoubleClick={() => startEdit(conv)}
              title={isEditing ? undefined : `${conv.title} — double-click để đổi tên`}
            >
              {isEditing ? (
                <input
                  ref={inputRef}
                  className="tab-edit"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commit}
                  onKeyDown={handleKeyDown}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <>
                  <span className="tab-title">{conv.title}</span>
                  <button
                    className="tab-rename"
                    title="Đổi tên"
                    onClick={(e) => {
                      e.stopPropagation()
                      startEdit(conv)
                    }}
                  >
                    ✎
                  </button>
                  <button
                    className="tab-close"
                    title="Đóng cuộc trò chuyện"
                    onClick={(e) => {
                      e.stopPropagation()
                      onClose(conv.id)
                    }}
                  >
                    ×
                  </button>
                </>
              )}
            </div>
          )
        })}
      </div>
      <button className="tab-new" title="Cuộc trò chuyện mới" onClick={onNew}>
        +
      </button>
    </div>
  )
}
