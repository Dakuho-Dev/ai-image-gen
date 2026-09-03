import React, { useEffect, useState } from 'react'

export default function SettingsModal({ onSave, onClose, dismissible }) {
  const [apiKey, setApiKey] = useState('')
  const [baseURL, setBaseURL] = useState('')
  const [model, setModel] = useState('gpt-image-1')
  const [customInstructions, setCustomInstructions] = useState('')
  const [appsScriptUrl, setAppsScriptUrl] = useState('')
  const [appsScriptSecret, setAppsScriptSecret] = useState('')
  const [imagesFolder, setImagesFolder] = useState('')
  const [folderMsg, setFolderMsg] = useState('')

  useEffect(() => {
    window.api.getSettings().then((settings) => {
      setApiKey(settings.apiKey || '')
      setBaseURL(settings.baseURL || '')
      setModel(settings.model || 'gpt-image-1')
      setCustomInstructions(settings.customInstructions || '')
      setAppsScriptUrl(settings.appsScriptUrl || '')
      setAppsScriptSecret(settings.appsScriptSecret || '')
    })
    window.api.getImagesFolder().then(setImagesFolder)
  }, [])

  async function handleChooseFolder() {
    const res = await window.api.chooseImagesFolder()
    if (res?.success) {
      setImagesFolder(res.path)
      setFolderMsg(
        res.moved > 0
          ? `Đã đổi thư mục và chuyển ${res.moved} ảnh sang vị trí mới.`
          : 'Đã đổi thư mục lưu ảnh.'
      )
    }
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (!apiKey.trim()) return
    onSave({
      apiKey: apiKey.trim(),
      baseURL: baseURL.trim(),
      model: model.trim() || 'gpt-image-1',
      customInstructions: customInstructions.trim(),
      appsScriptUrl: appsScriptUrl.trim(),
      appsScriptSecret: appsScriptSecret.trim(),
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

          <label htmlFor="appsScriptUrl" style={{ marginTop: 12 }}>
            Google Sheet — Apps Script URL (Sheet Batch Gen)
          </label>
          <input
            id="appsScriptUrl"
            type="text"
            value={appsScriptUrl}
            onChange={(e) => setAppsScriptUrl(e.target.value)}
            placeholder="https://script.google.com/macros/s/…/exec"
          />

          <label htmlFor="appsScriptSecret" style={{ marginTop: 12 }}>
            Apps Script Secret
          </label>
          <input
            id="appsScriptSecret"
            type="password"
            value={appsScriptSecret}
            onChange={(e) => setAppsScriptSecret(e.target.value)}
            placeholder="Chuỗi bí mật khớp SECRET trong Apps Script"
          />
          <p className="hint">
            Dùng cho tính năng gen ảnh hàng loạt từ Google Sheet queue. Để trống nếu không dùng.
            Cả hai phải khớp cấu hình trong Apps Script đã deploy.
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

        <div className="storage-section">
          <label>Thư mục lưu ảnh</label>
          <div className="folder-path" title={imagesFolder}>
            {imagesFolder || '—'}
          </div>
          <div className="folder-actions">
            <button type="button" className="btn secondary" onClick={handleChooseFolder}>
              📂 Chọn thư mục…
            </button>
            <button
              type="button"
              className="btn secondary"
              onClick={() => window.api.openImagesFolder()}
            >
              📁 Mở thư mục
            </button>
          </div>
          {folderMsg && <p className="hint">{folderMsg}</p>}
          <p className="hint">
            Tất cả ảnh được tạo ra đều lưu trong thư mục này. Khi đổi thư mục, các ảnh đã tạo sẽ
            được tự động chuyển sang vị trí mới.
          </p>
        </div>
      </div>
    </div>
  )
}
