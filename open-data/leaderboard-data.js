'use strict';

// This module stays inside the open data package. Never import it into the
// main game: its records can contain WeChat friend relationship information.
const DEFAULT_KEY = 'stars';
const LEGACY_KEY = 'wind_letter_rank_v1';
function legacyKeyFor(key) {
  if (key === DEFAULT_KEY) return LEGACY_KEY;
  if (key === DEFAULT_KEY + '_development') return LEGACY_KEY + '_development';
  return '';
}
const avatarUrl = value => typeof value === 'string' && value.length <= 1024 && /^https:\/\/(?:[a-z0-9-]+\.)*qlogo\.cn\/[a-zA-Z0-9_/?=&%.~-]*$/.test(value) ? value : '';
// This is an internal marker of an account-owned hosted record, never an
// OpenID, secret, or authentication credential. Main-domain input cannot set it.
const ownerToken = value => typeof value === 'string' && /^wl1_[a-f0-9]{48}$/.test(value) ? value : '';
const nativeId = value => typeof value === 'string' && value && value.trim() === value && !['selfopenid', 'self'].includes(value.toLowerCase()) ? value : '';
const cleanName = value => typeof value === 'string' ? Array.from(value.slice(0, 2048)
  .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '').trim()).slice(0, 24).join('') : '';

function isKVDataList(value) {
  return Array.isArray(value) && value.every(item => item && typeof item.key === 'string' && typeof item.value === 'string');
}

function cleanScore(score) {
  if (!score || ![score.stars, score.completed, score.turns].every(Number.isSafeInteger) ||
      score.completed < 1 || score.completed > 999 || score.stars < score.completed ||
      score.stars > score.completed * 3 || score.turns < score.completed || score.turns > 99900000) return null;
  return { v: 2, stars: score.stars, completed: score.completed, turns: score.turns,
    avatarUrl: avatarUrl(score.avatarUrl),
    name: cleanName(score.name) || '送信人',
    ...(ownerToken(score.ownerToken) ? { ownerToken: score.ownerToken } : {}) };
}
function cleanWxgame(value, stars) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !Number.isInteger(value.score) || value.score < -2147483648 || value.score > 2147483647 || value.score !== stars ||
      !Number.isSafeInteger(value.update_time) || value.update_time < 0) return null;
  return { score: value.score, update_time: value.update_time };
}
function parseScoreRecord(list, key) {
  if (!Array.isArray(list)) return null;
  const item = list.find(value => value && value.key === (key || DEFAULT_KEY));
  if (!item || typeof item.value !== 'string' || item.value.length > 2048) return null;
  try {
    const value = JSON.parse(item.value);
    const score = value && (value.v === 1 || value.v === 2) ? cleanScore(value) : null;
    return score ? { score, wxgame: cleanWxgame(value.wxgame, score.stars) } : null;
  } catch (_) { return null; }
}
function parseScore(list, key) { const record = parseScoreRecord(list, key); return record && record.score; }

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
function scoreFor(list, key) {
  const currentKey = key || DEFAULT_KEY;
  const legacyKey = legacyKeyFor(currentKey);
  return mergeScores(legacyKey ? parseScore(list, legacyKey) : null, parseScore(list, currentKey));
}
function utf8Length(value) {
  let size = 0;
  for (const char of value) { const code = char.codePointAt(0); size += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4; }
  return size;
}
function serializeScore(score, key, updateTime) {
  const value = cleanScore(score); if (!value) return null;
  const timestamp = Number.isSafeInteger(updateTime) && updateTime >= 0 ? updateTime : Math.floor(Date.now() / 1000);
  // Required by WeChat search/social rankings. Custom friend-ranking fields
  // remain alongside wxgame so old records and the in-game tie-breaks coexist.
  value.wxgame = { score: value.stars, update_time: timestamp };
  let json = JSON.stringify(value);
  if (utf8Length((key || DEFAULT_KEY) + json) > 1024) { value.avatarUrl = ''; json = JSON.stringify(value); }
  return utf8Length((key || DEFAULT_KEY) + json) <= 1024 ? json : null;
}
function buildRows(friends, mine, key, identity) {
  const mineScore = scoreFor(mine, key), seen = new Map(), rows = [];
  const ownId = nativeId(identity && identity.openId);
  if (Array.isArray(friends)) friends.forEach(function (friend) {
    if (!friend || !nativeId(friend.openid)) return;
    const score = scoreFor(friend.KVDataList, key);
    if (!score) return;
    const row = Object.assign(score, { openid: friend.openid, isMe: false,
      nickname: cleanName(friend.nickname) || score.name,
      avatarUrl: avatarUrl(friend.avatarUrl) || score.avatarUrl });
    const earlier = seen.get(friend.openid);
    if (!earlier || compareScores(row, earlier) < 0) seen.set(friend.openid, row);
  });
  let self = mineScore ? Object.assign({}, mineScore, { rank: null, isMe: true,
    nickname: cleanName(identity && identity.nickName) || mineScore.name, avatarUrl: avatarUrl(identity && identity.avatarUrl) || mineScore.avatarUrl }) : null;
  const marker = mineScore && ownerToken(mineScore.ownerToken);
  const markerMatches = marker ? Array.from(seen.values()).filter(row => row.ownerToken === marker) : [];
  // Only mark a record already returned by WeChat. Some runtimes echo the
  // selfOpenId input sentinel or use a different ID space in getUserInfo.
  // A unique marker from getUserCloudStorage is a display-only fallback.
  const matched = ownId && seen.get(ownId) || (markerMatches.length === 1 ? markerMatches[0] : null);
  if (matched) {
    const latest = mergeScores(matched, mineScore);
    Object.assign(matched, latest, { isMe: true,
      nickname: cleanName(identity && identity.nickName) || matched.nickname,
      avatarUrl: avatarUrl(identity && identity.avatarUrl) || matched.avatarUrl });
  }
  seen.forEach(function (row) { rows.push(row); });
  rows.sort(function (a, b) { return compareScores(a, b) || (a.openid < b.openid ? -1 : a.openid > b.openid ? 1 : 0); });
  let rank = 0;
  rows.forEach(function (row, index) { if (!index || compareScores(row, rows[index - 1]) !== 0) rank = index + 1; row.rank = rank; });
  self = rows.find(function (row) { return row.isMe; }) || self;
  return { rows, self };
}

module.exports = { DEFAULT_KEY, LEGACY_KEY, legacyKeyFor, isKVDataList, cleanScore, parseScoreRecord, parseScore,
  compareScores, mergeScores, scoreFor, serializeScore, buildRows };
