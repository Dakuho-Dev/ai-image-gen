import React, { useEffect, useRef, useState } from 'react'

const SIZES = [
  { value: 'auto', label: 'Tự động' },
  { value: '1024x1024', label: 'Vuông (1024x1024)' },
  { value: '1536x1024', label: 'Ngang (1536x1024)' },
  { value: '1024x1536', label: 'Dọc (1024x1536)' },
]

const QUALITIES = [
  { value: 'auto', label: 'Tự động' },
  { value: 'low', label: 'Thấp (nhanh nhất)' },
  { value: 'medium', label: 'Trung bình' },
  { value: 'high', label: 'Cao (chậm)' },
]

export default function Composer({ onSend, onStop, disabled, attachments, setAttachments }) {
  const [prompt, setPrompt] = useState('')
  const [count, setCount] = useState(1)
  const [size, setSize] = useState('auto')
  const [quality, setQuality] = useState('auto')
  const fileInputRef = useRef(null)
  const textareaRef = useRef(null)

  // Grow the textarea with its content (capped), shrinking back when cleared.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [prompt])

  function addImageFromFile(file) {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result
      const base64 = dataUrl.split(',')[1]
      setAttachments((prev) => [...prev, { data: base64, preview: dataUrl }])
    }
    reader.readAsDataURL(file)
  }

  function handlePaste(e) {
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) addImageFromFile(file)
        e.preventDefault()
      }
    }
  }

  function handleFileSelect(e) {
    const files = Array.from(e.target.files || [])
    files.forEach(addImageFromFile)
    e.target.value = ''
  }

  function removeImage(index) {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }

  function handleSubmit() {
    if (!prompt.trim() || disabled) return
    onSend({ prompt: prompt.trim(), images: attachments, count, size, quality })
    setPrompt('')
    setAttachments([])
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="composer">
      <div className={`composer-box ${disabled ? 'disabled' : ''}`}>
        {attachments.length > 0 && (
          <div className="attachments">
            {attachments.map((img, idx) => (
              <div className="attachment" key={idx}>
                <img src={img.preview} alt={`attachment-${idx}`} />
                <button className="remove-btn" onClick={() => removeImage(idx)}>
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <textarea
          ref={textareaRef}
          className="composer-textarea"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onPaste={handlePaste}
          onKeyDown={handleKeyDown}
          placeholder="Nhập prompt mô tả ảnh bạn muốn tạo... (có thể paste ảnh tham chiếu)"
          rows={1}
          disabled={disabled}
        />

        <div className="composer-toolbar">
          <div className="composer-tools">
            <button
              className="tool-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled}
              title="Đính kèm ảnh tham chiếu"
            >
              📎
            </button>
            <input
              type="file"
              ref={fileInputRef}
              accept="image/*"
              multiple
              style={{ display: 'none' }}
              onChange={handleFileSelect}
            />

            <label className="control-label">
              Số ảnh
              <select value={count} onChange={(e) => setCount(Number(e.target.value))} disabled={disabled}>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>

            <label className="control-label">
              Kích thước
              <select value={size} onChange={(e) => setSize(e.target.value)} disabled={disabled}>
                {SIZES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="control-label">
              Chất lượng
              <select value={quality} onChange={(e) => setQuality(e.target.value)} disabled={disabled}>
                {QUALITIES.map((q) => (
                  <option key={q.value} value={q.value}>
                    {q.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {disabled && onStop ? (
            <button
              className="send-btn stop"
              onClick={onStop}
              title="Dừng tạo ảnh"
            >
              <span className="stop-icon" />
            </button>
          ) : (
            <button
              className="send-btn"
              onClick={handleSubmit}
              disabled={disabled || !prompt.trim()}
              title="Tạo ảnh"
            >
              ↑
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
