import React, { useEffect } from 'react'

export default function Lightbox({ image, onClose, onSave, onUseForEdit }) {
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div className="lightbox-overlay" onClick={onClose}>
      <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
        <img src={image.src} alt="preview" />
        <div className="lightbox-actions">
          {onUseForEdit && (
            <button className="btn primary" onClick={onUseForEdit}>
              ✎ Dùng ảnh này để chỉnh sửa
            </button>
          )}
          {onSave && (
            <button className="btn secondary" onClick={onSave}>
              ⬇ Lưu ảnh
            </button>
          )}
          <button className="btn secondary" onClick={onClose}>
            Đóng
          </button>
        </div>
      </div>
    </div>
  )
}
