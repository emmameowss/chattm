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

function showModal({message, withInput = false, defaultValue = '', previewUrl = null}) {
    return new Promise((resolve) => {
        const overlay = document.querySelector('#modal-overlay')
        const msgEl = document.querySelector('#modal-message')
        const inputEl = document.querySelector('#modal-input')
        const confirmBtn = document.querySelector('#modal-confirm')
        const cancelBtn = document.querySelector('#modal-cancel')

        const preview = document.querySelector('#modal-emoji-preview')
        preview.hidden = !previewUrl
        if (previewUrl) preview.src = previewUrl
        confirmBtn.textContent = previewUrl ? 'delete emoji' : 'confirm'
        msgEl.textContent = message
        inputEl.style.display = withInput ? 'block' : 'none'
        inputEl.value = defaultValue
        overlay.style.display = 'flex'
        if (withInput) inputEl.focus()

        function cleanUp(result) {
            preview.hidden = true
            preview.removeAttribute('src')
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
let loaded = false
let loadError = ''
let loadRequest = 0
let busy = false
let previewUrl = null
const drawer = document.querySelector('#admin-emoji-drawer')
const backdrop = document.querySelector('#admin-emoji-drawer-backdrop')
const detail = document.querySelector('#admin-emoji-detail')
const search = document.querySelector('#admin-emoji-search')
const sort = document.querySelector('#admin-emoji-sort')
const maxFileSize = 2 * 1024 * 1024
const imageTypes = ['image/png', 'image/gif', 'image/webp', 'image/jpeg']

function element(tag, className, text) {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
}

async function readResponse(res) {
    if (res.redirected) {
        window.location.href = '/'
        throw new Error('sign in again to manage emoji')
    }
    const data = await res.json()
    if (!res.ok || data.success === false) throw new Error(data.error || 'request failed')
    return data
}

async function loadEmojis() {
    const request = ++loadRequest
    try {
        const res = await fetch('/admin/emoji/list', {credentials: 'same-origin'})
        const data = await readResponse(res)
        if (request !== loadRequest) return
        emojisData = data.emojis || []
        loaded = true
        loadError = ''
        if (selectedEmoji) {
            const updated = emojisData.find(emoji => emoji.shortcode === selectedEmoji.shortcode)
            if (updated) selectedEmoji = updated
            else if (!busy) closeEmoji()
        }
    } catch (e) {
        if (request !== loadRequest) return
        loadError = 'failed to load emoji. use refresh to try again.'
        showToast(e.message, 'error')
    }
    renderEmojis()
}

function renderEmojis() {
    const list = document.querySelector('#admin-emoji-list')
    const state = document.querySelector('#admin-emoji-state')
    const table = document.querySelector('#admin-emoji-table-wrap')
    const query = search.value.trim().toLowerCase()
    const filtered = emojisData.filter(emoji => emoji.shortcode.toLowerCase().includes(query))
        .sort((a, b) => sort.value === 'asc'
            ? a.shortcode.localeCompare(b.shortcode) : b.shortcode.localeCompare(a.shortcode))
    const focused = document.activeElement?.dataset.emojiOpen
    list.replaceChildren()
    state.hidden = loaded && !loadError && filtered.length > 0
    table.hidden = !state.hidden
    state.textContent = loadError || (!loaded ? 'loading emoji…'
        : emojisData.length === 0 ? 'no custom emoji yet. use add emoji to upload your first image.'
        : 'no emoji match your search.')
    document.querySelector('#admin-emoji-count').textContent = loaded ? 'custom emoji (' + emojisData.length + ')' : 'custom emoji'
    document.querySelector('#admin-emoji-results').textContent = loaded && !loadError
        ? filtered.length + ' of ' + emojisData.length + ' emoji' : ''
    document.querySelector('#admin-emoji-reset').hidden = !query && sort.value === 'asc'
    for (const emoji of filtered) {
        const row = element('tr', 'admin-directory-row')
        row.classList.toggle('selected', selectedEmoji?.shortcode === emoji.shortcode && drawer.open)
        const cell = element('td')
        const identity = element('div', 'admin-directory-identity')
        const thumbnail = element('div', 'admin-emoji-thumbnail')
        const image = element('img')
        image.src = emoji.url
        image.alt = ''
        image.loading = 'lazy'
        thumbnail.append(image)
        identity.append(thumbnail, element('code', 'admin-emoji-shortcode', emoji.shortcode))
        cell.append(identity)
        const actionCell = element('td')
        const button = element('button', 'admin-user-open')
        button.type = 'button'
        button.dataset.emojiOpen = emoji.shortcode
        button.setAttribute('aria-label', 'view ' + emoji.shortcode)
        const icon = element('i', 'ti ti-chevron-right')
        icon.setAttribute('aria-hidden', 'true')
        button.append(icon)
        button.disabled = busy
        button.addEventListener('click', () => openEmoji(emoji))
        actionCell.append(button)
        row.append(cell, actionCell)
        row.addEventListener('click', event => {
            if (!busy && !event.target.closest('button')) button.click()
        })
        list.append(row)
    }
    if (focused && !drawer.open) [...list.querySelectorAll('[data-emoji-open]')]
        .find(button => button.dataset.emojiOpen === focused)?.focus()
}

function releasePreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    previewUrl = null
}

function closeEmoji() {
    if (busy || document.querySelector('#modal-overlay').style.display !== 'none') return
    drawer.close()
    backdrop.hidden = true
    document.body.classList.remove('admin-drawer-open')
    selectedEmoji = null
    releasePreview()
    renderEmojis()
}

function openEmoji(emoji = null) {
    if (busy) return
    selectedEmoji = emoji
    renderEmojiEditor()
    if (!drawer.open) drawer.show()
    backdrop.hidden = false
    document.body.classList.add('admin-drawer-open')
    renderEmojis()
}

function renderEmojiEditor() {
    releasePreview()
    detail.replaceChildren()
    const existing = selectedEmoji
    document.querySelector('#admin-emoji-drawer-title').textContent = existing ? 'emoji details' : 'add emoji'
    const form = element('form', 'admin-emoji-form')
    const preview = element('div', 'admin-emoji-editor-preview')
    const image = element('img')
    image.alt = 'emoji preview'
    image.hidden = !existing
    if (existing) image.src = existing.url
    const placeholder = element('span', '', 'choose an image to preview')
    placeholder.hidden = !!existing
    preview.append(image, placeholder)

    const nameLabel = element('label', 'admin-users-filter', 'shortcode')
    const name = element('input')
    name.id = 'admin-emoji-name'
    name.name = 'shortcode'
    name.placeholder = 'happy_cat'
    name.value = existing ? existing.shortcode.slice(1, -1) : ''
    name.readOnly = !!existing
    name.required = true
    name.maxLength = existing ? Math.max(32, name.value.length) : 32
    if (!existing) name.pattern = '[a-z0-9_]{1,32}'
    name.autocomplete = 'off'
    nameLabel.append(name)
    const help = element('p', 'admin-emoji-help', existing
        ? 'replacing the image keeps this shortcode.'
        : '1–32 lowercase letters, numbers, or underscores. colons are added automatically.')
    const fileLabel = element('label', 'admin-users-filter', existing ? 'replacement image' : 'image')
    const file = element('input')
    file.type = 'file'
    file.name = 'file'
    file.accept = imageTypes.join(',')
    file.required = true
    fileLabel.append(file)
    const error = element('p', 'admin-emoji-error')
    error.setAttribute('role', 'alert')
    file.addEventListener('change', () => {
        releasePreview()
        error.textContent = ''
        const chosen = file.files[0]
        const invalid = chosen && (!imageTypes.includes(chosen.type) || chosen.size > maxFileSize || !chosen.size)
        file.setCustomValidity(invalid ? 'choose a PNG, GIF, WebP, or JPEG image up to 2 MB.' : '')
        if (chosen && !invalid) {
            previewUrl = URL.createObjectURL(chosen)
            image.src = previewUrl
            image.hidden = false
            placeholder.hidden = true
            if (!existing && !name.value) name.value = chosen.name.replace(/\.[^.]+$/, '')
                .toLowerCase().replace(/[^a-z0-9_]+/g, '_').slice(0, 32)
        } else {
            image.hidden = !existing
            placeholder.hidden = !!existing
            if (existing) image.src = existing.url
        }
        if (invalid) error.textContent = file.validationMessage
    })
    const submit = element('button', 'admin-emoji-primary', existing ? 'replace image' : 'add emoji')
    submit.type = 'submit'
    form.append(preview, nameLabel, help, fileLabel,
        element('p', 'admin-emoji-help', 'PNG, GIF, WebP, or JPEG · up to 2 MB'), error, submit)
    form.addEventListener('submit', async event => {
        event.preventDefault()
        if (busy || !form.reportValidity()) return
        const payload = new FormData(form)
        busy = true
        error.textContent = ''
        submit.textContent = 'uploading…'
        setBusy(true)
        try {
            const res = await fetch(existing ? '/admin/emoji/replace' : '/admin/emoji/add', {
                method: 'POST', credentials: 'same-origin', body: payload
            })
            const data = await readResponse(res)
            selectedEmoji = data.emoji
            emojisData = emojisData.filter(emoji => emoji.shortcode !== data.emoji.shortcode)
            emojisData.push(data.emoji)
            renderEmojiEditor()
            showToast(existing ? 'emoji image replaced' : 'emoji added', 'success')
            await loadEmojis()
        } catch (e) {
            error.textContent = e.message
        } finally {
            busy = false
            submit.textContent = existing ? 'replace image' : 'add emoji'
            setBusy(false)
            if (!selectedEmoji && existing) closeEmoji()
            renderEmojis()
        }
    })
    detail.append(form)
    if (existing) {
        const actions = element('div', 'admin-detail-actions admin-emoji-detail-actions')
        for (const [label, value] of [['copy shortcode', existing.shortcode], ['copy URL', existing.url]]) {
            const button = element('button', '', label)
            button.type = 'button'
            button.addEventListener('click', () => copyToClipboard(value))
            actions.append(button)
        }
        const remove = element('button', 'destructive', 'delete emoji')
        remove.type = 'button'
        remove.addEventListener('click', () => deleteEmoji(existing))
        actions.append(remove)
        detail.append(actions)
    }
}

function setBusy(value) {
    document.querySelectorAll('#admin-emoji-detail button, #admin-emoji-detail input, #admin-emoji-add, #admin-emoji-refresh, #admin-emoji-drawer-close')
        .forEach(control => { control.disabled = value })
    detail.setAttribute('aria-busy', String(value))
    renderEmojis()
}

async function deleteEmoji(emoji) {
    if (busy) return
    const confirmed = await showModal({previewUrl: emoji.url, message: 'permanently delete ' + emoji.shortcode
        + '?\n\nthis removes the image from storage. old messages will show the shortcode instead.'})
    if (!confirmed || busy) return
    busy = true
    setBusy(true)
    try {
        const res = await fetch('/admin/emoji/delete', {
            method: 'POST', headers: {'content-type': 'application/json'},
            body: JSON.stringify({session, shortcode: emoji.shortcode})
        })
        await readResponse(res)
        showToast('emoji deleted', 'success')
        busy = false
        closeEmoji()
        await loadEmojis()
    } catch (e) {
        showToast(e.message, 'error')
    } finally {
        busy = false
        setBusy(false)
    }
}

document.querySelector('#admin-emoji-add').addEventListener('click', () => openEmoji())
document.querySelector('#admin-emoji-refresh').addEventListener('click', loadEmojis)
document.querySelector('#admin-emoji-drawer-close').addEventListener('click', closeEmoji)
backdrop.addEventListener('click', closeEmoji)
drawer.addEventListener('cancel', event => { event.preventDefault(); closeEmoji() })
search.addEventListener('input', renderEmojis)
sort.addEventListener('change', renderEmojis)
document.querySelector('#admin-emoji-reset').addEventListener('click', () => {
    search.value = ''
    sort.value = 'asc'
    renderEmojis()
})
socket.on('emojiUpdate', loadEmojis)
socket.on('connect_error', () => showToast('connection lost. use refresh to update the library.', 'error'))
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
