import { randomUUID } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { extname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import formidable from 'formidable';
import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

const imageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const fileTypes = [...imageTypes, 'video/mp4', 'video/quicktime', 'audio/mpeg', 'audio/ogg', 'audio/wav',
  'application/pdf', 'text/plain', 'text/markdown', 'application/zip', 'application/x-rar-compressed',
  'application/x-7z-compressed', 'application/x-tar', 'application/gzip', 'application/json', 'text/csv',
  'image/vnd.adobe.photoshop', 'application/figma'];
const staffRoles = ['mod', 'admin', 'owner'];
function fail(message, statusCode = 403) { throw Object.assign(new Error(message), { statusCode }); }
const fileUrl = file => `/dm/files/${file.id}${extname(file.object_key)}`;

export function createDmService(deps) {
  const { store, io, getSession, getRequestUser, getRole, isBanned, isMuted, identity,
    getEmailByUsername, checkRateLimit, validateContent, consumeCooldown, s3, getReportById } = deps;
  const privateBucket = () => deps.privateBucket();
  function actor(user) {
    if (!user || user.guest || user.email.endsWith('@guest')) fail('sign in with a registered account', 401);
    if (deps.sessionAllowed && !deps.sessionAllowed(user)) fail('session expired', 401);
    if (isBanned(user.email)) fail('banned');
    return user.email;
  }
  function socketActor(socket) {
    const user = getSession(socket.handshake.auth.session);
    if (!user || user.email !== socket.userEmail) fail('session expired', 401);
    return actor(user);
  }
  function member(email, id) {
    if (typeof id !== 'string') fail('conversation not found', 404);
    const conversation = store.getConversation(id);
    if (!conversation || ![conversation.participant_a, conversation.participant_b].includes(email)) fail('conversation not found', 404);
    return conversation;
  }
  const peer = (conversation, email) => conversation.participant_a === email ? conversation.participant_b : conversation.participant_a;
  function sending(email, conversation) {
    if (isMuted(email)) fail('you are muted');
    if (isBanned(peer(conversation, email))) fail('this account is unavailable');
    if (store.hasBlock(email, peer(conversation, email)) || store.hasBlock(peer(conversation, email), email)) fail('messaging is blocked');
  }
  function summary(conversation, email) {
    const other = peer(conversation, email);
    let profile = { ...identity(other), ...deps.peerProfile?.(other) };
    const blockedByMe = store.hasBlock(email, other);
    if (blockedByMe) profile = { username: profile.username, avatar: null, color: null,
      isToken: false, verified: false, redVerified: false, pronouns: "", status: "", online: false };
    return { id: conversation.id, peer: { username: profile.username, avatar: profile.avatar,
      color: profile.color, isOwner: profile.isToken, verified: profile.verified, redVerified: profile.redVerified,
      pronouns: profile.pronouns || "", status: profile.status || "online", online: !!profile.online, blockedByMe },
      updatedAt: conversation.updated_at, latestSeq: conversation.latest_seq,
      unread: conversation.unread || 0, blockedByMe: store.hasBlock(email, other),
      blocked: store.hasBlock(email, other) || store.hasBlock(other, email) };
  }
  function publicMessage(message, email) {
    const { ownerEmail, ...data } = message;
    const reply = data.replyTo ? store.getMessage(data.replyTo) : null;
    const authorBlocked = store.hasBlock(email, ownerEmail);
    return { ...data, authorBlocked, profileUsername: identity(ownerEmail).username, mine: ownerEmail === email,
      ...(authorBlocked ? { avatar: null, color: null, isToken: false, verified: false, redVerified: false } : {}),
      replyTo: data.replyTo ? { id: data.replyTo, deleted: !reply,
        ...(reply && reply.conversationId === data.conversationId ? {
          username: reply.username, text: reply.text, image: reply.image, color: reply.color,
          avatar: reply.avatar, isToken: reply.isToken, verified: reply.verified, redVerified: reply.redVerified,
          ...(store.hasBlock(email, reply.ownerEmail) ? { authorBlocked: true, username: "blocked", avatar: null,
            color: "var(--muted)", isToken: false, verified: false, redVerified: false } : {}),
        } : {}) } : null };
  }
  function emitUser(email, event, payload) {
    for (const socket of io.sockets.sockets.values()) {
      // Recheck local session revocation before sending private content.
      const session = getSession(socket.handshake.auth.session);
      if (socket.userEmail === email && session?.email === email && !session.guest && !isBanned(email) && (!deps.sessionAllowed || deps.sessionAllowed(session))) socket.emit(event, payload);
    }
  }
  function update(email) { emitUser(email, 'dmList', store.list(email).map(c => summary(c, email))); }
  function updatePair(conversation) { update(conversation.participant_a); update(conversation.participant_b); }
  function stopTyping(socket) {
    if (!socket.currentDm) return;
    const conversation = store.getConversation(socket.currentDm);
    if (!conversation) return;
    for (const other of io.sockets.sockets.values()) {
      if (other.currentDm === conversation.id && other.userEmail === peer(conversation, socket.userEmail)) {
        try { socketActor(other); other.emit('dmTyping', { conversationId: conversation.id, username: socket.username, typing: false }); } catch {}
      }
    }
  }
  function attach(socket) {
    if (!socket.userEmail.endsWith('@guest')) update(socket.userEmail);
    const on = (event, handler) => socket.on(event, (payload = {}, ack) => {
      if (typeof ack !== 'function') return;
      try {
        const email = socketActor(socket);
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail('invalid request', 400);
        if (!checkRateLimit(email, 'dm-action', 150, 60_000)) fail('slow down', 429);
        ack({ success: true, ...handler(email, payload) });
      } catch (error) { ack({ success: false, error: error.statusCode ? error.message : 'could not complete DM action' }); }
    });
    on('dmOpen', (email, payload) => {
      if (typeof payload.username !== 'string' || payload.username.length > 80) fail('invalid account', 400);
      const other = getEmailByUsername(payload.username);
      if (!other || other.endsWith('@guest') || other === email || isBanned(other)) fail('account unavailable', 404);
      if (!checkRateLimit(email, 'dm-open', 30, 60_000)) fail('too many conversations', 429);
      const conversation = store.open(randomUUID(), email, other);
      updatePair(conversation);
      return { conversation: summary(conversation, email) };
    });
    on('dmSwitch', (email, payload) => {
      const conversation = member(email, payload.conversationId);
      stopTyping(socket);
      deps.leaveChannel(socket);
      socket.currentDm = conversation.id;
      return { conversation: summary(conversation, email), messages: store.history(conversation.id).map(m => publicMessage(m, email)) };
    });
    on('dmSend', (email, payload) => {
      const conversation = member(email, payload.conversationId);
      sending(email, conversation);
      const text = payload.text == null ? '' : payload.text;
      validateContent(text, payload.attachmentId ? null : payload.image);
      if (text.startsWith('/')) fail('commands are unavailable in direct messages', 400);
      if (!text.trim() && !payload.attachmentId && !payload.image) fail('message is empty', 400);
      let replyTo = null;
      if (payload.replyTo != null) {
        if (typeof payload.replyTo !== 'string') fail('invalid reply', 400);
        const reply = store.getMessage(payload.replyTo);
        if (!reply || reply.conversationId !== conversation.id) fail('reply must be in this conversation', 400);
        replyTo = reply.id;
      }
      let attachment = null;
      if (payload.attachmentId != null) {
        if (typeof payload.attachmentId !== 'string') fail('invalid attachment', 400);
        attachment = store.getAttachment(payload.attachmentId);
        if (!attachment || attachment.conversation_id !== conversation.id || attachment.uploader !== email || attachment.message_id) fail('attachment unavailable', 400);
      }
      // A private URL may only reference an existing file in this conversation.
      for (const match of `${text} ${payload.image || ''}`.matchAll(/\/dm\/files\/([a-f0-9-]{36})/g)) {
        const file = store.getAttachment(match[1]);
        if (!file || file.conversation_id !== conversation.id || (!file.message_id && file.id !== attachment?.id)) fail('attachment unavailable', 400);
        if (file.message_id && !store.getMessage(file.message_id)) fail('attachment unavailable', 400);
      }
      const profile = identity(email);
      const url = attachment ? fileUrl(attachment) : null;
      const isMedia = attachment && (imageTypes.includes(attachment.mime) || attachment.mime.startsWith('video/'));
      const outgoingText = attachment && !isMedia ? `${text}${text ? ' ' : ''}${attachment.filename}: ${url}` : text;
      validateContent(outgoingText, attachment ? null : payload.image);
      consumeCooldown(email);
      const message = store.addMessage(conversation.id, email, randomUUID(), {
        ...profile, text: outgoingText || null,
        image: attachment ? isMedia ? url : null : payload.image || null,
        attachmentId: attachment?.id || null, replyTo, mentions: [], isGuest: false,
      }, attachment?.id);
      for (const participant of [conversation.participant_a, conversation.participant_b]) {
        emitUser(participant, 'dmMessage', publicMessage(message, participant));
      }
      updatePair(store.getConversation(conversation.id));
      return { messageId: message.id };
    });
    on('dmDelete', (email, payload) => {
      const conversation = member(email, payload.conversationId);
      const message = typeof payload.messageId === 'string' ? store.getMessage(payload.messageId) : null;
      if (!message || message.conversationId !== conversation.id) fail('message not found', 404);
      if (message.ownerEmail !== email) fail('you can only delete your own messages');
      store.deleteMessage(message.id);
      for (const participant of [conversation.participant_a, conversation.participant_b]) emitUser(participant, 'dmDeleted', { conversationId: conversation.id, messageId: message.id });
      updatePair(conversation);
      return {};
    });
    on('dmRead', (email, payload) => {
      const conversation = member(email, payload.conversationId);
      if (socket.currentDm !== conversation.id || !Number.isSafeInteger(payload.seq) || payload.seq < 0 || payload.seq > conversation.latest_seq) fail('invalid read position', 400);
      store.markRead(conversation.id, email, payload.seq);
      update(email);
      return {};
    });
    on('dmBlock', (email, payload) => {
      const conversation = member(email, payload.conversationId);
      if (typeof payload.blocked !== 'boolean') fail('invalid block request', 400);
      store.setBlock(email, peer(conversation, email), payload.blocked);
      for (const other of io.sockets.sockets.values()) if (other.currentDm === conversation.id) stopTyping(other);
      updatePair(conversation);
      deps.blockChanged?.(email);
      for (const viewer of io.sockets.sockets.values()) {
        if (viewer.userEmail === email && viewer.currentDm === conversation.id) {
          emitUser(email, 'dmHistory', { conversationId: conversation.id,
            messages: store.history(conversation.id).map(message => publicMessage(message, email)) });
          break;
        }
      }
      return {};
    });
    on('dmTyping', (email, payload) => {
      const conversation = member(email, payload.conversationId);
      sending(email, conversation);
      if (socket.currentDm !== conversation.id || typeof payload.typing !== 'boolean') fail('invalid typing request', 400);
      if (payload.typing && deps.invisible?.(email)) return {};
      for (const other of io.sockets.sockets.values()) {
        if (other.currentDm === conversation.id && other.userEmail === peer(conversation, email)) {
          try { socketActor(other); other.emit('dmTyping', { conversationId: conversation.id, username: identity(email).username, typing: payload.typing }); } catch {}
        }
      }
      return {};
    });
    socket.on('disconnect', () => stopTyping(socket));
  }
  function reportEvidence(user, messageId) {
    const email = actor(user);
    const message = typeof messageId === 'string' ? store.getMessage(messageId) : null;
    if (!message) fail('message not found', 404);
    member(email, message.conversationId);
    if (message.ownerEmail === email) fail('you cannot report your own message', 400);
    const context = store.context(message).map(m => {
      const attachmentIds = new Set(m.attachmentId ? [m.attachmentId] : []);
      for (const match of `${m.text || ''} ${m.image || ''}`.matchAll(/\/dm\/files\/([a-f0-9-]{36})/g)) {
        const file = store.getAttachment(match[1]);
        if (file?.conversation_id === message.conversationId && file.message_id) attachmentIds.add(file.id);
      }
      return { messageId: m.id, authorUsername: m.username, text: m.text, image: m.image,
        time: m.time, attachmentId: m.attachmentId || null, attachmentIds: [...attachmentIds] };
    });
    return { targetKey: message.id, targetEmail: message.ownerEmail, targetUsername: message.username,
      snapshot: { ...context.find(m => m.messageId === message.id), conversationId: message.conversationId, context } };
  }
  function attachmentFor(user, id, reportId = null) {
    const email = actor(user);
    const file = store.getAttachment(id);
    if (!file) fail('file not found', 404);
    if (reportId !== null) {
      if (!staffRoles.includes(getRole(email))) fail('file not found', 404);
      const report = getReportById(reportId);
      if (!report || report.targetType !== 'dm_message' || !report.snapshot.context.some(m => m.attachmentId === id || m.attachmentIds?.includes(id))) fail('file not found', 404);
    } else {
      member(email, file.conversation_id);
      if (file.message_id) {
        if (!store.getMessage(file.message_id)) fail('file not found', 404);
      } else if (file.uploader !== email) fail('file not found', 404);
    }
    return file;
  }
  function staffReport(report) {
    if (report?.targetType !== 'dm_message') return report;
    const context = report.snapshot.context.map(m => {
      let text = m.text;
      let image = m.image;
      for (const attachmentId of m.attachmentIds || (m.attachmentId ? [m.attachmentId] : [])) {
        const file = store.getAttachment(attachmentId);
        if (!file) continue;
        const url = `/admin/reports/${report.id}/files/${file.id}${extname(file.object_key)}`;
        if (image) image = image.split(fileUrl(file)).join(url);
        if (text) text = text.split(fileUrl(file)).join(url);
      }
      return { ...m, image, text };
    });
    return { ...report, snapshot: { ...report.snapshot, ...context.find(m => m.messageId === report.targetKey), context } };
  }
  async function handleHttp(req, res, url) {
    const upload = url.pathname === '/dm/upload';
    const fileMatch = url.pathname.match(/^\/dm\/files\/([a-f0-9-]{36})(?:\.[a-z0-9]+)?$/);
    const evidenceMatch = url.pathname.match(/^\/admin\/reports\/(\d+)\/files\/([a-f0-9-]{36})(?:\.[a-z0-9]+)?$/);
    if (!upload && !fileMatch && !evidenceMatch) return false;
    const send = (code, data) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'private, no-store' }); res.end(JSON.stringify(data)); };
    let tempFiles = [];
    let uploadedKey = null;
    try {
      // These routes are same-origin, cookie authenticated, and never enable CORS.
      if (req.headers.origin && req.headers.origin !== `${req.socket.encrypted ? 'https' : 'http'}://${req.headers.host}` &&
          new URL(req.headers.origin).host !== req.headers.host) fail('forbidden origin');
      const user = getRequestUser(req);
      const email = actor(user);
      if (deps.ensureSessionActive && !await deps.ensureSessionActive(user)) fail('session expired', 401);
      if (!privateBucket()) fail('private DM uploads are not configured', 503);
      if (upload) {
        if (req.method !== 'POST') fail('method not allowed', 405);
        const conversation = member(email, url.searchParams.get('conversationId'));
        sending(email, conversation);
        if (!checkRateLimit(email, 'dm-upload', 50, 60 * 60_000)) fail('too many uploads', 429);
        const form = formidable({ maxFileSize: 50 * 1024 * 1024, maxTotalFileSize: 50 * 1024 * 1024, maxFiles: 1,
          maxFields: 2, maxFieldsSize: 1024 });
        form.on('fileBegin', (_name, file) => tempFiles.push(file.filepath));
        const [, files] = await form.parse(req);
        const file = files.file?.[0];
        if (!file || !fileTypes.includes(file.mimetype)) fail('file type not allowed', 400);
        const bytes = await readFile(file.filepath);
        // Recheck revocation, block, and mute after the asynchronous upload parse.
        const current = actor(getRequestUser(req));
        if (current !== email) fail('session expired', 401);
        sending(email, member(email, conversation.id));
        const extension = extname(file.originalFilename || '').toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 10);
        const id = randomUUID();
        uploadedKey = `dm/${id}${extension}`;
        await s3.send(new PutObjectCommand({ Bucket: privateBucket(), Key: uploadedKey, Body: bytes, ContentType: file.mimetype }));
        if (actor(getRequestUser(req)) !== email) fail('session expired', 401);
        sending(email, member(email, conversation.id));
        store.addAttachment({ id, conversationId: conversation.id, uploader: email, key: uploadedKey,
          filename: (file.originalFilename || 'file').replace(/[\r\n\x00-\x1f]/g, '').slice(0, 180), mime: file.mimetype, size: bytes.length });
        uploadedKey = null;
        send(201, { attachmentId: id });
      } else {
        if (!['GET', 'HEAD'].includes(req.method)) fail('method not allowed', 405);
        const file = attachmentFor(user, fileMatch?.[1] || evidenceMatch[2], evidenceMatch ? Number(evidenceMatch[1]) : null);
        let range;
        if (req.headers.range) {
          const match = req.headers.range.match(/^bytes=(\d*)-(\d*)$/);
          if (!match || (!match[1] && !match[2])) fail('invalid range', 416);
          const start = match[1] ? Number(match[1]) : Math.max(0, file.size - Number(match[2]));
          const end = match[1] ? match[2] ? Math.min(file.size - 1, Number(match[2])) : file.size - 1 : file.size - 1;
          if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= file.size) {
            res.setHeader('content-range', `bytes */${file.size}`); fail('invalid range', 416);
          }
          range = `bytes=${start}-${end}`;
        }
        const object = await s3.send(new GetObjectCommand({ Bucket: privateBucket(), Key: file.object_key, ...(range ? { Range: range } : {}) }));
        try {
          attachmentFor(getRequestUser(req), file.id, evidenceMatch ? Number(evidenceMatch[1]) : null);
        } catch (error) { object.Body.destroy(); throw error; }
        const headers = { 'content-type': file.mime, 'content-length': object.ContentLength, 'cache-control': 'private, no-store',
          'x-content-type-options': 'nosniff', 'accept-ranges': 'bytes',
          'content-security-policy': "sandbox; default-src 'none'",
          'content-disposition': `${imageTypes.includes(file.mime) || file.mime.startsWith('video/') || file.mime.startsWith('audio/') ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.filename)}` };
        if (object.ContentRange) headers['content-range'] = object.ContentRange;
        res.writeHead(range ? 206 : 200, headers);
        if (req.method === 'HEAD') { object.Body.destroy(); res.end(); }
        else await pipeline(object.Body, res);
      }
    } catch (error) {
      if (uploadedKey) await s3.send(new DeleteObjectCommand({ Bucket: privateBucket(), Key: uploadedKey })).catch(() => {});
      if (!res.headersSent) send(error.statusCode || (error.httpCode === 413 ? 413 : 500), { error: error.statusCode ? error.message : 'could not process private file' });
      else res.destroy();
    } finally { await Promise.allSettled(tempFiles.map(path => unlink(path))); }
    return true;
  }
  return { attach, stopTyping, update, updatePair, reportEvidence, attachmentFor, staffReport, handleHttp, member, socketActor };
}
