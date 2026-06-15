import React, { useState } from 'react'

// The app ships with the default Electron icon (the orbital "atom" mark), so the
// assistant avatar reuses that logo to stay consistent with the app icon.
function ElectronIcon() {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="50" fill="#9FEAF9" />
      <g fill="none" stroke="#2B2E3B" strokeWidth="5">
        <ellipse cx="50" cy="50" rx="44" ry="17" />
        <ellipse cx="50" cy="50" rx="44" ry="17" transform="rotate(60 50 50)" />
        <ellipse cx="50" cy="50" rx="44" ry="17" transform="rotate(120 50 50)" />
      </g>
      <circle cx="50" cy="50" r="8" fill="#2B2E3B" />
    </svg>
  )
}

export default function ChatMessage({ message, onImageClick, onEdit, editDisabled }) {
  const { role } = message
  const isUser = role === 'user'
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.text || '')
  const canEdit = isUser && onEdit && message.text

  function startEdit() {
    setDraft(message.text || '')
    setEditing(true)
  }

  function saveEdit() {
    const trimmed = draft.trim()
    if (!trimmed || trimmed === message.text) {
      setEditing(false)
      return
    }
    onEdit(message.id, trimmed)
    setEditing(false)
  }

  function handleEditKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      saveEdit()
    } else if (e.key === 'Escape') {
      setEditing(false)
    }
  }

  return (
    <div className={`msg-row ${role}`}>
      <div className={`avatar ${isUser ? 'user' : 'assistant'}`}>
        {isUser ? '🧑' : <ElectronIcon />}
      </div>
      <div className="msg-body">
        <span className="msg-name">{isUser ? 'Bạn' : 'DakuhoAI'}</span>
        {role === 'error' ? (
          <div className="bubble error">{message.text}</div>
        ) : (
          <div className="msg-content">
            {editing ? (
              <div className="bubble edit-bubble">
                <textarea
                  className="edit-textarea"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={handleEditKeyDown}
                  autoFocus
                  rows={2}
                />
                <div className="edit-actions">
                  <button className="edit-cancel" onClick={() => setEditing(false)}>
                    Hủy
                  </button>
                  <button className="edit-save" onClick={saveEdit}>
                    Lưu &amp; tạo lại
                  </button>
                </div>
              </div>
            ) : (
              message.text && (
                <div className="bubble">
                  <p className="bubble-text">{message.text}</p>
                  {canEdit && (
                    <button
                      className="edit-btn"
                      onClick={startEdit}
                      disabled={editDisabled}
                      title={editDisabled ? 'Đang tạo ảnh...' : 'Sửa và tạo lại'}
                    >
                      ✏️ Sửa
                    </button>
                  )}
                </div>
              )
            )}
            {message.images && message.images.length > 0 && (
              <div className="image-grid">
                {message.images.map((src, idx) =>
                  src ? (
                    <div className="image-item" key={idx}>
                      <img
                        src={src}
                        alt={`result-${idx}`}
                        loading="lazy"
                        onClick={() => onImageClick(src, message.imageIds?.[idx])}
                      />
                    </div>
                  ) : (
                    <div className="image-item placeholder" key={idx}>
                      <div className="img-spinner" />
                    </div>
                  )
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
