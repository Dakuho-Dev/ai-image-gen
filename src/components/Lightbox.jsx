import React, { useEffect } from 'react'

export default function Lightbox({ image, onClose, onSave, onSaveAll, onUseForEdit, onMakeMockups, onWriteListing, listingBusy, onNavigate }) {
  const { images = [], index = 0 } = image
  const src = images[index] ?? image.src
  const hasMultiple = images.length > 1

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        onClose()
      } else if (hasMultiple && e.key === 'ArrowLeft') {
        e.preventDefault()
        onNavigate((index - 1 + images.length) % images.length)
      } else if (hasMultiple && e.key === 'ArrowRight') {
        e.preventDefault()
        onNavigate((index + 1) % images.length)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, onNavigate, hasMultiple, index, images.length])

  return (
    <div className="lightbox-overlay" onClick={onClose}>
      <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
        {hasMultiple && (
          <button
            className="lightbox-nav prev"
            onClick={() => onNavigate((index - 1 + images.length) % images.length)}
            aria-label="Ảnh trước"
          >
            ‹
          </button>
        )}
        <img src={src} alt="preview" />
        {hasMultiple && (
          <button
            className="lightbox-nav next"
            onClick={() => onNavigate((index + 1) % images.length)}
            aria-label="Ảnh sau"
          >
            ›
          </button>
        )}
        {hasMultiple && (
          <div className="lightbox-counter">
            {index + 1} / {images.length}
          </div>
        )}
        <div className="lightbox-actions">
          {onUseForEdit && (
            <button className="btn primary" onClick={onUseForEdit}>
              ✎ Dùng ảnh này để chỉnh sửa
            </button>
          )}
          {onWriteListing && (
            <button className="btn secondary" onClick={onWriteListing} disabled={listingBusy}>
              {listingBusy ? '⏳ Đang viết…' : '✍️ Viết tiêu đề & mô tả'}
            </button>
          )}
          {onMakeMockups && (
            <button className="btn secondary" onClick={onMakeMockups}>
              🖼️ Tạo bộ mockup
            </button>
          )}
          {onSave && (
            <button className="btn secondary" onClick={onSave}>
              ⬇ Lưu ảnh
            </button>
          )}
          {onSaveAll && (
            <button className="btn secondary" onClick={onSaveAll}>
              📦 Lưu cả bộ ({image.imageIds.length})
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