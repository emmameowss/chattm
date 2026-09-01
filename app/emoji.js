const session = localStorage.getItem('session')
if (!session) window.location.href = '/'

const socket = io(window.location.origin, {
    auth: {session},
    transports: ['websocket']
})

const logsTab = document.querySelector('#logs')

logsTab.addEventListener('click', () => {
    showToast('action logs have not been implemented yet, check back later', 'info')
})

function showModal({message, withInput = false, defaultValue = ''}) {
    return new Promise((resolve) => {
        const overlay = document.querySelector('#modal-overlay')
        const msgEl = document.querySelector('#modal-message')
        const inputEl = document.querySelector('#modal-input')
        const confirmBtn = document.querySelector('#modal-confirm')
        const cancelBtn = document.querySelector('#modal-cancel')

        msgEl.textContent = message
        inputEl.style.display = withInput ? 'block' : 'none'
        inputEl.value = defaultValue
        overlay.style.display = 'flex'
        if (withInput) inputEl.focus()

        function cleanUp(result) {
            overlay.style.display = 'none'
            confirmBtn.removeEventListener('click', onConfirm)
            cancelBtn.removeEventListener('click', onCancel)
            if (withInput) inputEl.removeEventListener('keydown', onKey)
            resolve(result)
        }
        function onConfirm() {
            cleanUp(withInput ? inputEl.value : true)
        }
        function onCancel() {
            cleanUp(withInput ? null : false)
        }
        function onKey(e) {
            if (e.key === "Enter") {
                e.preventDefault()
                onConfirm()
            } else if (e.key === "Escape") {
                e.preventDefault()
                onCancel()
            }
        }
        confirmBtn.addEventListener('click', onConfirm)
        cancelBtn.addEventListener('click', onCancel)
        if (withInput) inputEl.addEventListener('keydown', onKey)
    })
}

function showToast(message, type = 'info') {
    const container = document.querySelector('#toast-container')
    const toast = document.createElement('div')
    toast.className = `toast ${type}`
    toast.textContent = message
    container.appendChild(toast)

    setTimeout(() => {
        toast.style.opacity = '0'
        toast.style.transform = 'translateY(10px)'
        toast.style.transition = 'opacity 0.2s, transform 0.2s'
        setTimeout(() => toast.remove(), 200)
    }, 3000)
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        showToast('copied to clipboard', 'success')
    }).catch(() => {
        showToast('failed to copy', 'error')
    }) 
}

let selectedEmoji = null
let emojisData = []

async function loadEmojis() {
    try {
        const res = await fetch('/admin/emoji/list', {
            credentials: 'same-origin'
        })
        const data = await res.json()
        emojisData = data.emojis || []
        renderEmojis(emojisData)
    } catch (e) {
        console.error('failed to load emojis:', e)
        showToast('failed to load emojis: ' + e.message, 'error')
    }
}

function renderEmojis(emojis) {
    const sidebar = document.querySelector('#admin-emoji-sidebar')
    sidebar.innerHTML = ''

    if (emojis.length === 0) {
        const empty = document.createElement('div')
        empty.className = 'admin-users-detail-empty'
        empty.textContent = 'no custom emojis'
        empty.style.height = "100%"
        sidebar.appendChild(empty)
        return
    }

    const header = document.createElement('div')
    header.className = 'admin-user-section'
    header.textContent = `custom emojis (${emojis.length})`
    sidebar.appendChild(header)

    for (const emoji of emojis) {
        const row = document.createElement('div')
        row.className = 'admin-emoji-row'
        if (selectedEmoji && selectedEmoji.shortcode === emoji.shortcode) {
            row.classList.add('selected')
        }

        const thumbnail = document.createElement('div')
        thumbnail.className = 'admin-emoji-thumbnail'
        const img = document.createElement('img')
        img.src = emoji.url
        img.alt = emoji.shortcode
        thumbnail.appendChild(img)
        row.appendChild(thumbnail)

        const info = document.createElement('div')
        info.className = 'admin-emoji-info'

        const shortcode = document.createElement('div')
        shortcode.className = 'admin-emoji-shortcode'
        shortcode.textContent = emoji.shortcode
        info.appendChild(shortcode)

        row.appendChild(info)
        row.addEventListener('click', () => {
            selectedEmoji = emoji
            renderEmojis(emojisData)
            renderEmojiDetail(emoji)
        })
        sidebar.appendChild(row)
    }
}

function renderEmojiDetail(emoji) {
    const detail = document.querySelector('#admin-emoji-detail')
    detail.innerHTML = ''

    const content = document.createElement('div')
    content.className = 'admin-users-detail-content'

    const header = document.createElement('div')
    header.className = 'admin-users-detail-header'

    const preview = document.createElement('div')
    preview.className = 'admin-emoji-preview'
    const img = document.createElement('img')
    img.src = emoji.url
    img.alt = emoji.shortcode
    preview.appendChild(img)
    header.appendChild(preview)

    const info = document.createElement('div')
    info.className = 'admin-emoji-detail-info'

    const name = document.createElement('div')
    name.className = 'admin-emoji-detail-name'
    name.textContent = emoji.shortcode
    info.appendChild(name)
    header.appendChild(info)
    content.appendChild(header)

    const section = document.createElement('div')
    section.className = 'admin-detail-section'

    const sectionTitle = document.createElement('div')
    sectionTitle.className = 'admin-detail-section-title'
    sectionTitle.textContent = 'emoji details'
    section.appendChild(sectionTitle)

    const urlField = document.createElement('div')
    urlField.className = 'admin-detail-field'

    const urlLabel = document.createElement('div')
    urlLabel.className = 'admin-detail-field-label'
    urlLabel.textContent = 'url'
    urlField.appendChild(urlLabel)

    const urlValue = document.createElement('span')
    urlValue.className = 'admin-clerk-id'
    urlValue.textContent = emoji.url.slice(0,70)

    const copyBtn = document.createElement('button')
    copyBtn.innerHTML = '<i class="ti ti-copy"></i>'
    copyBtn.onclick = () => copyToClipboard(emoji.url)
    urlValue.appendChild(copyBtn)
    
    urlField.appendChild(urlValue)
    section.appendChild(urlField)

    content.appendChild(section)

    const actionsSection = document.createElement('div')
    actionsSection.className = 'admin-detail-section'

    const actionsTitle = document.createElement('div')
    actionsTitle.className = 'admin-detail-section-title'
    actionsTitle.textContent = 'actions'
    actionsSection.appendChild(actionsTitle)

    const actionsDiv = document.createElement('div')
    actionsDiv.className = 'admin-detail-actions'

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'destructive';
    deleteBtn.innerHTML = '<i class="ti ti-trash"></i> delete emoji';
    deleteBtn.onclick = (e) => deleteEmoji(emoji.shortcode, e);
    actionsDiv.appendChild(deleteBtn);

    actionsSection.appendChild(actionsDiv);
    content.appendChild(actionsSection);

    detail.appendChild(content);
}

async function deleteEmoji(shortcode, event) {
    const confirmed = await showModal({
        message: `delete ${shortcode}?\n\nthis can't be undone`,
        withInput: false
    })
    if (!confirmed) return

    const btn = event.target.closest('button')
    btn.classList.add('loading')
    btn.disabled = true
    const originalHTML = btn.innerHTML
    btn.innerHTML = '<i class="ti ti-loader admin-loading-spinner"></i> deleting...';

    try {
        const res = await fetch('/admin/emoji/delete', {
            method: "POST",
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({session,shortcode})
        })
        const data = await res.json()
        if (data.success) {
            showToast('emoji deleted', 'success')
            selectedEmoji = null
            await loadEmojis()
            document.querySelector('#admin-emoji-detail').innerHTML = '<div class="admin-users-detail-empty">select an emoji to view details</div>';
        } else {
            showToast(data.error || 'failed to delete emoji', 'error')
            btn.classList.remove('loading')
            btn.disabled = false
            btn.innerHTML = originalHTML
        }
    } catch (e) {
        showToast('error: ' + e.message, 'error')
        btn.classList.remove('loading')
        btn.disabled = false
        btn.innerHTML = originalHTML
    }
}

socket.on('emojiUpdate', async () => {
    await loadEmojis()
    if (selectedEmoji) {
        const updated = emojisData.find(e => e.shortcode === selectedEmoji.shortcode)
        if (updated) {
            renderEmojiDetail(updated)
        } else {
            selectedEmoji = null
            document.querySelector('#admin-emoji-detail').innerHTML = '<div class="admin-users-detail-empty">select an emoji to view details</div>';
        }
    }
})

loadEmojis()

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', addDevBadge);
} else {
  addDevBadge();
}

function addDevBadge() {
  const h = location.hostname;
  if (["beta.chattm.app", "localhost", "127.0.0.1"].includes(h)) {
    const h1 = document.querySelector("h1");
    if (h1 && !h1.querySelector(".dev-badge")) {
      const badge = document.createElement("span");
      badge.className = "dev-badge";
      badge.textContent = h === "beta.chattm.app" ? "beta" : "dev";
      badge.title =
        h === "beta.chattm.app"
          ? "this is a beta instance of chat™, updates are done on every push to dev"
          : "this is a dev instance of chat™";
      h1.appendChild(badge);
    }
  }
}