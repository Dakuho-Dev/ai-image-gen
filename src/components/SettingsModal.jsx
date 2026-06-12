import React, { useEffect, useState } from 'react'

export default function SettingsModal({ onSave, onClose, dismissible }) {
  const [apiKey, setApiKey] = useState('')
  const [baseURL, setBaseURL] = useState('')
  const [model, setModel] = useState('gpt-image-1')
  const [customInstructions, setCustomInstructions] = useState('')
  const [version, setVersion] = useState('')
  // Update flow: { status, version?, percent?, message? }
  const [update, setUpdate] = useState({ status: 'idle' })

  useEffect(() => {
    window.api.getSettings().then((settings) => {
      setApiKey(settings.apiKey || '')
      setBaseURL(settings.baseURL || '')
      setModel(settings.model || 'gpt-image-1')
      setCustomInstructions(settings.customInstructions || '')
    })
    window.api.getAppVersion().then(setVersion)
  }, [])

  // Subscribe to live update status pushed from the main process.
  useEffect(() => {
    return window.api.onUpdateStatus((data) => setUpdate(data))
  }, [])

  async function handleCheck() {
    setUpdate({ status: 'checking' })
    const res = await window.api.checkForUpdate()
    if (!res.ok) {
      setUpdate({
        status: 'error',
        message:
          res.reason === 'dev'
            ? 'Tính năng cập nhật chỉ hoạt động ở bản đã cài đặt.'
            : res.reason,
      })
    }
  }

  async function handleDownload() {
    setUpdate({ status: 'downloading', percent: 0 })
    const res = await window.api.downloadUpdate()
    if (!res.ok) setUpdate({ status: 'error', message: res.reason })
  }

  function handleInstall() {
    window.api.installUpdate()
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (!apiKey.trim()) return
    onSave({
      apiKey: apiKey.trim(),
      baseURL: baseURL.trim(),
      model: model.trim() || 'gpt-image-1',
      customInstructions: customInstructions.trim(),
    })
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h2>Cài đặt</h2>
        <form onSubmit={handleSubmit}>
          <label htmlFor="apiKey">API Key</label>
          <input
            id="apiKey"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
            autoFocus
          />

          <label htmlFor="baseURL" style={{ marginTop: 12 }}>
            API Base URL (tùy chọn)
          </label>
          <input
            id="baseURL"
            type="text"
            value={baseURL}
            onChange={(e) => setBaseURL(e.target.value)}
            placeholder="https://api.openai.com/v1 (để trống nếu dùng OpenAI mặc định)"
          />
          <p className="hint">
            Nếu bạn dùng dịch vụ proxy (vd: shopaikey.com), nhập endpoint tại đây. Với tác vụ tạo
            ảnh (dễ timeout), nên dùng endpoint "Direct" của nhà cung cấp.
          </p>

          <label htmlFor="model" style={{ marginTop: 12 }}>
            Model
          </label>
          <input
            id="model"
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="gpt-image-1"
          />
          <p className="hint">
            Tên model tạo ảnh. Tùy nhà cung cấp mà tên model có thể khác (vd: gpt-image-1,
            dall-e-3, hoặc tên model Gemini tương ứng).
          </p>

          <label htmlFor="customInstructions" style={{ marginTop: 12 }}>
            Yêu cầu đặc biệt (tự động thêm vào mọi prompt)
          </label>
          <textarea
            id="customInstructions"
            value={customInstructions}
            onChange={(e) => setCustomInstructions(e.target.value)}
            placeholder="vd: ảnh không nền (nền trong suốt), nền trắng, phong cách tối giản..."
            rows={3}
          />
          <p className="hint">
            Những yêu cầu này được lưu lại và tự động nối vào cuối prompt mỗi lần tạo ảnh. Để
            trống nếu không cần.
          </p>

          <div className="modal-actions">
            {dismissible && (
              <button type="button" className="btn secondary" onClick={onClose}>
                Hủy
              </button>
            )}
            <button type="submit" className="btn primary">
              Lưu
            </button>
          </div>
        </form>

        <div className="update-section">
          <div className="update-row">
            <span className="update-version">Phiên bản {version || '—'}</span>
            {!['checking', 'downloading', 'downloaded', 'available'].includes(update.status) && (
              <button type="button" className="btn secondary" onClick={handleCheck}>
                Kiểm tra cập nhật
              </button>
            )}
            {update.status === 'available' && (
              <button type="button" className="btn primary" onClick={handleDownload}>
                ⬇ Tải bản {update.version}
              </button>
            )}
            {update.status === 'downloaded' && (
              <button type="button" className="btn primary" onClick={handleInstall}>
                ↻ Khởi động lại để cập nhật
              </button>
            )}
          </div>

          {update.status === 'checking' && <p className="hint">Đang kiểm tra cập nhật…</p>}
          {update.status === 'not-available' && (
            <p className="hint">Bạn đang dùng phiên bản mới nhất.</p>
          )}
          {update.status === 'available' && (
            <p className="hint">Đã có bản mới {update.version}. Nhấn để tải về.</p>
          )}
          {update.status === 'downloading' && (
            <p className="hint">Đang tải bản cập nhật… {update.percent ?? 0}%</p>
          )}
          {update.status === 'downloaded' && (
            <p className="hint">Đã tải xong. Khởi động lại để áp dụng bản {update.version}.</p>
          )}
          {update.status === 'error' && (
            <p className="hint" style={{ color: '#ff9d9d' }}>
              {update.message}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
