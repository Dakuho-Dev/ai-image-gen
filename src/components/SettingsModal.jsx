import React, { useEffect, useState } from 'react'

export default function SettingsModal({ onSave, onClose, dismissible }) {
  const [apiKey, setApiKey] = useState('')
  const [baseURL, setBaseURL] = useState('')
  const [model, setModel] = useState('gpt-image-1')
  const [textModel, setTextModel] = useState('gpt-4.1')
  const [customInstructions, setCustomInstructions] = useState('')
  const [appsScriptUrl, setAppsScriptUrl] = useState('')
  const [appsScriptSecret, setAppsScriptSecret] = useState('')
  const [imagesFolder, setImagesFolder] = useState('')
  const [folderMsg, setFolderMsg] = useState('')
  // Wiki: thư mục markdown làm nguồn kiến thức khi viết tiêu đề & mô tả.
  // `files` là toàn bộ .md quét được, `selected` là những file thật sự gửi lên API.
  const [wiki, setWiki] = useState({ dir: '', files: [], selected: [] })
  // Vault thật có hàng trăm file — không lọc thì không tick nổi.
  const [wikiFilter, setWikiFilter] = useState('')

  useEffect(() => {
    window.api.getSettings().then((settings) => {
      setApiKey(settings.apiKey || '')
      setBaseURL(settings.baseURL || '')
      setModel(settings.model || 'gpt-image-1')
      setTextModel(settings.textModel || 'gpt-4.1')
      setCustomInstructions(settings.customInstructions || '')
      setAppsScriptUrl(settings.appsScriptUrl || '')
      setAppsScriptSecret(settings.appsScriptSecret || '')
    })
    window.api.getImagesFolder().then(setImagesFolder)
    window.api.getWikiInfo().then((res) => {
      if (res) setWiki({ dir: res.dir || '', files: res.files || [], selected: res.selected || [] })
    })
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

  async function handleChooseWiki() {
    const res = await window.api.chooseWikiFolder()
    if (res?.ok) setWiki({ dir: res.dir, files: res.files || [], selected: [] })
  }

  // Lựa chọn lưu ngay khi tick (không chờ nút Lưu) để phần chọn file và phần
  // cấu hình API không dính vào nhau.
  function toggleWikiFile(rel) {
    setWiki((prev) => {
      const selected = prev.selected.includes(rel)
        ? prev.selected.filter((r) => r !== rel)
        : [...prev.selected, rel]
      window.api.setWikiSelection(selected)
      return { ...prev, selected }
    })
  }

  function setWikiSelection(list) {
    setWiki((prev) => {
      window.api.setWikiSelection(list)
      return { ...prev, selected: list }
    })
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (!apiKey.trim()) return
    onSave({
      apiKey: apiKey.trim(),
      baseURL: baseURL.trim(),
      model: model.trim() || 'gpt-image-1',
      textModel: textModel.trim() || 'gpt-4.1',
      customInstructions: customInstructions.trim(),
      appsScriptUrl: appsScriptUrl.trim(),
      appsScriptSecret: appsScriptSecret.trim(),
    })
  }

  const shownFiles = wikiFilter.trim()
    ? wiki.files.filter((f) => f.rel.toLowerCase().includes(wikiFilter.trim().toLowerCase()))
    : wiki.files
  const selectedCount = wiki.selected.length
  const totalBytes = wiki.files.reduce((sum, f) => sum + f.size, 0)
  const selectedBytes = wiki.files
    .filter((f) => wiki.selected.includes(f.rel))
    .reduce((sum, f) => sum + f.size, 0)
  // ~4 ký tự / token là ước lượng đủ dùng để cảnh báo về chi phí mỗi lần viết.
  const kb = (n) => `${Math.round(n / 1024)} KB`
  const tokens = (n) => `≈${Math.round(n / 4 / 1000)}k token`
  // Không tick gì thì main dùng cả thư mục, nhưng chỉ khi dưới 200 KB.
  const WIKI_AUTO_LIMIT = 200 * 1024
  const wikiTooBig = selectedCount === 0 && totalBytes > WIKI_AUTO_LIMIT

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

          <label htmlFor="textModel" style={{ marginTop: 12 }}>
            Model viết chữ (tiêu đề & mô tả)
          </label>
          <input
            id="textModel"
            type="text"
            value={textModel}
            onChange={(e) => setTextModel(e.target.value)}
            placeholder="gpt-4.1"
          />
          <p className="hint">
            Model dùng khi bấm "Viết tiêu đề &amp; mô tả" trong ảnh phóng to. Phải là model đọc
            được ảnh (vd: gpt-4.1, gpt-4o, gpt-5). Khác với model tạo ảnh ở trên.
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
          <label>Thư mục wiki (kiến thức viết listing)</label>
          <div className="folder-path" title={wiki.dir}>
            {wiki.dir || '—'}
          </div>
          <div className="folder-actions">
            <button type="button" className="btn secondary" onClick={handleChooseWiki}>
              📂 Chọn thư mục…
            </button>
            <button
              type="button"
              className="btn secondary"
              onClick={() => window.api.openWikiFolder()}
            >
              📁 Mở thư mục
            </button>
          </div>

          {wiki.files.length === 0 ? (
            <p className="hint">
              Không tìm thấy file .md nào. Trỏ tới thư mục wiki hoặc vault Obsidian của Sếp.
            </p>
          ) : (
            <>
              <div className="wiki-picker-head">
                {selectedCount > 0 ? (
                  <span>
                    Đã chọn <strong>{selectedCount}</strong>/{wiki.files.length} file ·{' '}
                    {kb(selectedBytes)} · {tokens(selectedBytes)} mỗi lần viết
                  </span>
                ) : wikiTooBig ? (
                  <span className="wiki-warn">
                    ⚠ Chưa tick file nào — thư mục {wiki.files.length} file / {kb(totalBytes)},
                    vượt giới hạn 200 KB nên phải chọn file cụ thể.
                  </span>
                ) : (
                  <span>
                    Chưa tick file nào → dùng cả {wiki.files.length} file · {kb(totalBytes)} ·{' '}
                    {tokens(totalBytes)}
                  </span>
                )}
                <span className="wiki-picker-links">
                  <button
                    type="button"
                    onClick={() =>
                      setWikiSelection([
                        ...new Set([...wiki.selected, ...shownFiles.map((f) => f.rel)]),
                      ])
                    }
                  >
                    Chọn hết ({shownFiles.length})
                  </button>
                  <button type="button" onClick={() => setWikiSelection([])}>
                    Bỏ chọn hết
                  </button>
                </span>
              </div>
              <input
                type="text"
                className="wiki-filter"
                value={wikiFilter}
                onChange={(e) => setWikiFilter(e.target.value)}
                placeholder="Lọc theo đường dẫn, vd: 02-wiki/market"
              />
              <div className="wiki-picker">
                {shownFiles.length === 0 && (
                  <p className="hint" style={{ margin: 6 }}>
                    Không có file nào khớp bộ lọc.
                  </p>
                )}
                {shownFiles.map((f) => (
                  <label key={f.rel} className="wiki-file">
                    <input
                      type="checkbox"
                      checked={wiki.selected.includes(f.rel)}
                      onChange={() => toggleWikiFile(f.rel)}
                    />
                    <span className="wiki-file-name" title={f.rel}>
                      {f.rel}
                    </span>
                    <span className="wiki-file-size">{Math.max(1, Math.round(f.size / 1024))} KB</span>
                  </label>
                ))}
              </div>
              <p className="hint">
                Chỉ những file được tick mới gửi lên API khi viết tiêu đề &amp; mô tả — chọn phần
                luật (chuẩn title/tag, từ vựng, hồ sơ khách, thông số sản phẩm), bỏ qua dữ liệu
                thô và log. Không tick file nào thì app dùng tất cả, nhưng chỉ khi tổng dung
                lượng dưới 200 KB.
              </p>
            </>
          )}
        </div>

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
