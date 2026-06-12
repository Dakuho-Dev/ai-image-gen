import React, { useEffect, useState } from 'react'

// Floating version/update indicator pinned to the bottom-left of the app.
// The main process auto-checks on startup (packaged builds) and pushes status
// here, so a new release surfaces as a notification card without user action.
export default function UpdateWidget() {
  const [version, setVersion] = useState('')
  // Update flow: { status, version?, percent?, message? }
  const [update, setUpdate] = useState({ status: 'idle' })
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    window.api.getAppVersion().then(setVersion)
    const unsubscribe = window.api.onUpdateStatus((data) => {
      setUpdate(data)
      setDismissed(false) // a fresh status re-opens the card
    })
    // Silently kick off a check now that we're subscribed, so a new release is
    // caught even if the main process's startup check fired before this mounted.
    // Results arrive via onUpdateStatus; the returned value is ignored (e.g.
    // { reason: 'dev' } in unpackaged dev builds).
    window.api.checkForUpdate().catch(() => {})
    return unsubscribe
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

  const hasUpdate = ['available', 'downloading', 'downloaded'].includes(update.status)
  const showCard =
    !dismissed &&
    ['available', 'downloading', 'downloaded', 'checking', 'not-available', 'error'].includes(
      update.status
    )

  return (
    <div className="update-widget">
      {showCard && (
        <div className="update-card">
          <button
            className="update-card-close"
            title="Đóng"
            onClick={() => setDismissed(true)}
          >
            ×
          </button>

          {update.status === 'checking' && (
            <p className="update-card-text">Đang kiểm tra cập nhật…</p>
          )}

          {update.status === 'available' && (
            <>
              <p className="update-card-title">🎉 Đã có bản mới {update.version}</p>
              <p className="update-card-text">Tải về để cập nhật phiên bản mới nhất.</p>
              <button className="btn primary update-card-btn" onClick={handleDownload}>
                ⬇ Tải bản {update.version}
              </button>
            </>
          )}

          {update.status === 'downloading' && (
            <>
              <p className="update-card-title">Đang tải bản cập nhật…</p>
              <div className="update-progress">
                <div
                  className="update-progress-bar"
                  style={{ width: `${update.percent ?? 0}%` }}
                />
              </div>
              <p className="update-card-text">{update.percent ?? 0}%</p>
            </>
          )}

          {update.status === 'downloaded' && (
            <>
              <p className="update-card-title">✓ Đã tải xong bản {update.version}</p>
              <p className="update-card-text">Khởi động lại để áp dụng cập nhật.</p>
              <button className="btn primary update-card-btn" onClick={handleInstall}>
                ↻ Khởi động lại để cập nhật
              </button>
            </>
          )}

          {update.status === 'not-available' && (
            <p className="update-card-text">Bạn đang dùng phiên bản mới nhất.</p>
          )}

          {update.status === 'error' && (
            <p className="update-card-text error">{update.message}</p>
          )}
        </div>
      )}

      <button
        className={`update-pill ${hasUpdate ? 'has-update' : ''}`}
        onClick={handleCheck}
        title="Nhấn để kiểm tra cập nhật"
      >
        <span className="update-pill-dot" />
        Phiên bản {version || '—'}
      </button>
    </div>
  )
}
