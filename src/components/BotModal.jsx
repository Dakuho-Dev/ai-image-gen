import React, { useState } from 'react'

// Create or edit a bot. A bot is just a name plus its own Instructions, which
// replace the global custom instructions for conversations opened from it.
export default function BotModal({ bot, onSave, onClose }) {
  const [name, setName] = useState(bot?.name || '')
  const [instructions, setInstructions] = useState(bot?.instructions || '')
  const isEdit = Boolean(bot)

  function handleSubmit(e) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    onSave({ name: trimmed, instructions })
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{isEdit ? 'Sửa Bot' : 'Tạo Bot mới'}</h2>
        <form onSubmit={handleSubmit}>
          <label htmlFor="botName">Tên Bot</label>
          <input
            id="botName"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ví dụ: Thiết kế logo, Ảnh sản phẩm..."
            autoFocus
          />

          <label htmlFor="botInstructions" style={{ marginTop: 12 }}>
            Instructions riêng
          </label>
          <textarea
            id="botInstructions"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Ví dụ: Luôn tạo ảnh nền trắng, phong cách tối giản..."
            rows={6}
          />
          <p className="hint">
            Hướng dẫn này được áp dụng cho mọi cuộc trò chuyện mở từ bot, thay cho
            phần "Yêu cầu đặc biệt" chung trong Cài đặt.
          </p>

          <div className="modal-actions">
            <button type="button" className="btn secondary" onClick={onClose}>
              Hủy
            </button>
            <button type="submit" className="btn primary" disabled={!name.trim()}>
              {isEdit ? 'Lưu' : 'Tạo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
