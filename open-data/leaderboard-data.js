'use strict';

// This module stays inside the open data package. Never import it into the
// main game: its records can contain WeChat friend relationship information.
const DEFAULT_KEY = 'wind_letter_rank_v1';
const avatarUrl = value => typeof value === 'string' && value.length <= 1024 && /^https:\/\/(?:[a-z0-9-]+\.)*qlogo\.cn\/[a-zA-Z0-9_/?=&%.~-]*$/.test(value) ? value : '';
// This is an internal marker of an account-owned hosted record, never an
// OpenID, secret, or authentication credential. Main-domain input cannot set it.
const ownerToken = value => typeof value === 'string' && /^wl1_[a-f0-9]{48}$/.test(value) ? value : '';
const nativeId = value => typeof value === 'string' && value && value.trim() === value && !['selfopenid', 'self'].includes(value.toLowerCase()) ? value : '';

function cleanScore(score) {
  if (!score || ![score.stars, score.completed, score.turns].every(Number.isSafeInteger) ||
      score.completed < 1 || score.completed > 999 || score.stars < score.completed ||
      score.stars > score.completed * 3 || score.turns < score.completed || score.turns > 99900000) return null;
  return { v: 2, stars: score.stars, completed: score.completed, turns: score.turns,
    avatarUrl: avatarUrl(score.avatarUrl),
    name: typeof score.name === 'string' ? Array.from(score.name).slice(0, 24).join('') : '送信人',
    ...(ownerToken(score.ownerToken) ? { ownerToken: score.ownerToken } : {}) };
}
function parseScore(list, key) {
  if (!Array.isArray(list)) return null;
  const item = list.find(value => value && value.key === (key || DEFAULT_KEY));
  if (!item || typeof item.value !== 'string' || item.value.length > 2048) return null;
  try { const score = JSON.parse(item.value); return score && (score.v === 1 || score.v === 2) ? cleanScore(score) : null; } catch (_) { return null; }
}

function compareScores(a, b) {
  return b.stars - a.stars || b.completed - a.completed || a.turns - b.turns;
}

function mergeScores(hosted, local) {
  if (!hosted) return local;
  if (!local) return hosted;
  const best = compareScores(hosted, local) < 0 ? hosted : local;
  return Object.assign({}, best, { name: local.name || hosted.name, avatarUrl: local.avatarUrl || hosted.avatarUrl,
    ...(ownerToken(hosted.ownerToken) || ownerToken(local.ownerToken) ? { ownerToken: ownerToken(hosted.ownerToken) || ownerToken(local.ownerToken) } : {}) });
}
function utf8Length(value) {
  let size = 0;
  for (const char of value) { const code = char.codePointAt(0); size += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4; }
  return size;
}
function serializeScore(score, key) {
  const value = cleanScore(score); if (!value) return null;
  let json = JSON.stringify(value);
  if (utf8Length((key || DEFAULT_KEY) + json) > 1024) { value.avatarUrl = ''; json = JSON.stringify(value); }
  return utf8Length((key || DEFAULT_KEY) + json) <= 1024 ? json : null;
}
function buildRows(friends, mine, key, identity) {
  const mineScore = parseScore(mine, key), seen = new Map(), rows = [];
  const ownId = nativeId(identity && identity.openId);
  if (Array.isArray(friends)) friends.forEach(function (friend) {
    if (!friend || !nativeId(friend.openid)) return;
    const score = parseScore(friend.KVDataList, key);
    if (!score) return;
    const row = Object.assign(score, { openid: friend.openid, isMe: false,
      nickname: typeof friend.nickname === 'string' && friend.nickname.trim() ? friend.nickname : score.name,
      avatarUrl: avatarUrl(friend.avatarUrl) || score.avatarUrl });
    const earlier = seen.get(friend.openid);
    if (!earlier || compareScores(row, earlier) < 0) seen.set(friend.openid, row);
  });
  let self = mineScore ? Object.assign({}, mineScore, { rank: null, isMe: true,
    nickname: identity && identity.nickName || mineScore.name, avatarUrl: avatarUrl(identity && identity.avatarUrl) || mineScore.avatarUrl }) : null;
  const marker = mineScore && ownerToken(mineScore.ownerToken);
  const markerMatches = marker ? Array.from(seen.values()).filter(row => row.ownerToken === marker) : [];
  // Only mark a record already returned by WeChat. Some runtimes echo the
  // selfOpenId input sentinel or use a different ID space in getUserInfo.
  // A unique marker from getUserCloudStorage is a display-only fallback.
  const matched = ownId && seen.get(ownId) || (markerMatches.length === 1 ? markerMatches[0] : null);
  if (matched) {
    const latest = mergeScores(matched, mineScore);
    Object.assign(matched, latest, { isMe: true,
      nickname: identity && identity.nickName || matched.nickname,
      avatarUrl: avatarUrl(identity && identity.avatarUrl) || matched.avatarUrl });
  }
  seen.forEach(function (row) { rows.push(row); });
  rows.sort(function (a, b) { return compareScores(a, b) || (a.openid < b.openid ? -1 : a.openid > b.openid ? 1 : 0); });
  let rank = 0;
  rows.forEach(function (row, index) { if (!index || compareScores(row, rows[index - 1]) !== 0) rank = index + 1; row.rank = rank; });
  self = rows.find(function (row) { return row.isMe; }) || self;
  return { rows, self };
}

module.exports = { DEFAULT_KEY, cleanScore, parseScore, compareScores, mergeScores, serializeScore, buildRows };
