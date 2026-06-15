import React, { useState } from 'react'
import UpdateWidget from './UpdateWidget.jsx'

// Collapsible left sidebar. Holds a "Bots" section (user-defined bots, each
// opening a chat tab with its own Instructions) plus a footer with the
// settings button and version/update indicator.
export default function Sidebar({ collapsed, onToggle, bots, onOpenBot, onAddBot, onEditBot, onDeleteBot, onOpenSettings }) {
  const [botsOpen, setBotsOpen] = useState(true)

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <button className="sidebar-toggle" onClick={onToggle} title={collapsed ? 'Mở menu' : 'Thu gọn menu'}>
        {collapsed ? '»' : '«'}
      </button>

      {!collapsed && (
        <div className="sidebar-content">
          <div className="sidebar-section">
            <button className="section-header" onClick={() => setBotsOpen((v) => !v)}>
              <span className={`section-caret ${botsOpen ? 'open' : ''}`}>▸</span>
              <span className="section-title">Bots</span>
              <span
                className="section-add"
                title="Tạo bot mới"
                onClick={(e) => {
                  e.stopPropagation()
                  onAddBot()
                }}
              >
                +
              </span>
            </button>

            {botsOpen && (
              <div className="section-body">
                {bots.length === 0 && (
                  <p className="section-empty">Chưa có bot nào. Bấm + để tạo.</p>
                )}
                {bots.map((bot) => (
                  <div className="bot-item" key={bot.id}>
                    <button
                      className="bot-name"
                      onClick={() => onOpenBot(bot)}
                      title={bot.instructions ? bot.instructions : 'Mở cuộc trò chuyện với bot này'}
                    >
                      🤖 {bot.name}
                    </button>
                    <div className="bot-actions">
                      <button
                        className="bot-action"
                        title="Sửa bot"
                        onClick={() => onEditBot(bot)}
                      >
                        ✏️
                      </button>
                      <button
                        className="bot-action"
                        title="Xóa bot"
                        onClick={() => onDeleteBot(bot)}
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {!collapsed && (
        <div className="sidebar-footer">
          <button className="sidebar-settings" onClick={onOpenSettings} title="Cài đặt">
            ⚙ Cài đặt
          </button>
          <UpdateWidget />
        </div>
      )}
    </aside>
  )
}
