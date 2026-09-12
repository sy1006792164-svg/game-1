'use strict';

const { CAMPAIGN } = require('./levels');
const { difficultyProfile } = require('./difficulty');

const JOURNEY_TARGET = 6;
const MAX_JOURNEY_DAYS = 30;
const MAX_DAY_POINTS = 999;
const MAX_EARNED_DAYS = 36600;
const LEVELS = new Map(CAMPAIGN.map(level => [String(level.id), level]));
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function field(value, key) {
  if (!object(value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && own(descriptor, 'value') ? descriptor.value : undefined;
}

function journeyDate(value = new Date()) {
  if (value instanceof Date || typeof value === 'number') {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    value = String(date.getFullYear()).padStart(4, '0') + '-' +
      String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

function campaignLevel(levelId) {
  const id = typeof levelId === 'number' && Number.isInteger(levelId) ? String(levelId) : levelId;
  return typeof id === 'string' ? LEVELS.get(id) || null : null;
}

function journeyPoints(levelId) {
  const level = campaignLevel(levelId);
  if (!level) return 0;
  const points = (level.difficulty || difficultyProfile(level)).journeyPoints;
  if ([1, 2, 3].includes(points)) return points;
  return 0;
}

function dayPoints(day) {
  if (!object(day)) return 0;
  return Math.min(MAX_DAY_POINTS, Object.keys(day).reduce((sum, id) => sum + day[id], 0));
}

function normalizeJourney(value, completed) {
  const rawDays = field(value, 'days');
  const days = {};
  let archivedThrough = journeyDate(field(value, 'archivedThrough') || null);
  if (object(rawDays)) {
    Object.keys(rawDays).filter(date => journeyDate(date) && (!archivedThrough || date > archivedThrough))
      .sort().forEach(date => {
        const rawDay = field(rawDays, date);
        if (!object(rawDay)) return;
        const day = {};
        let points = 0;
        Object.keys(rawDay).slice(0, CAMPAIGN.length).forEach(id => {
          const expected = journeyPoints(id), entry = field(rawDay, id);
          if (!expected || entry !== expected || (completed && !field(completed, id)) || points + expected > MAX_DAY_POINTS) return;
          day[id] = expected; points += expected;
        });
        if (Object.keys(day).length) days[date] = day;
      });
  }
  const completedDays = Object.values(days).filter(day => dayPoints(day) >= JOURNEY_TARGET).length;
  const total = field(value, 'earnedDays');
  const earnedDays = Math.max(completedDays,
    Number.isInteger(total) && total >= 0 && total <= MAX_EARNED_DAYS ? total : 0);
  const dates = Object.keys(days);
  dates.slice(0, Math.max(0, dates.length - MAX_JOURNEY_DAYS)).forEach(date => {
    archivedThrough = date; delete days[date];
  });
  const next = { days, earnedDays };
  if (archivedThrough) next.archivedThrough = archivedThrough;
  return next;
}

function addJourneyWin(value, levelId, when) {
  const journey = normalizeJourney(value);
  const date = journeyDate(when), level = campaignLevel(levelId), points = journeyPoints(levelId);
  const unchanged = { journey, changed: false, credited: 0, stampEarned: false };
  if (!date || !level || (journey.archivedThrough && date <= journey.archivedThrough)) return unchanged;
  const before = journey.days[date] || {};
  if (own(before, String(level.id)) || dayPoints(before) + points > MAX_DAY_POINTS) return unchanged;
  const wasDone = dayPoints(before) >= JOURNEY_TARGET;
  journey.days[date] = { ...before, [level.id]: points };
  const stampEarned = !wasDone && dayPoints(journey.days[date]) >= JOURNEY_TARGET;
  if (stampEarned) journey.earnedDays = Math.min(MAX_EARNED_DAYS, journey.earnedDays + 1);
  return { journey: normalizeJourney(journey), changed: true, credited: points, stampEarned };
}

function getJourney(profile, when = new Date()) {
  const date = journeyDate(when), completed = field(profile, 'completed') || {};
  const journey = normalizeJourney(field(profile, 'journey'), completed);
  const day = date && journey.days[date] || {};
  const points = dayPoints(day), candidates = [];
  const available = CAMPAIGN.filter((level, index) => index === 0 || !!field(completed, String(CAMPAIGN[index - 1].id)));
  const eligible = level => level && !own(day, String(level.id));
  function recommend(level, reason) {
    if (!eligible(level) || candidates.some(candidate => candidate.levelId === level.id)) return;
    candidates.push({ levelId: level.id, points: journeyPoints(level.id), reason });
  }
  recommend(available.find(level => !field(completed, String(level.id))), '主线前进');
  recommend(available.find(level => {
    const record = field(completed, String(level.id));
    return record && record.stars < 3 && eligible(level);
  }), '重走摘星');
  const chapterChallenge = available.filter(level => eligible(level) && level.id % 6 === 0).pop();
  recommend(chapterChallenge, '章节难关');
  if (!candidates.length) recommend(available.find(eligible), '重温投递');
  return {
    date, points, target: JOURNEY_TARGET, done: points >= JOURNEY_TARGET,
    earnedDays: journey.earnedDays, remaining: Math.max(0, JOURNEY_TARGET - points),
    creditedLevelIds: Object.keys(day).map(Number), candidates,
    nextLevelId: candidates.length ? candidates[0].levelId : null
  };
}

module.exports = {
  JOURNEY_TARGET, MAX_JOURNEY_DAYS, MAX_DAY_POINTS, MAX_EARNED_DAYS,
  journeyDate, localDate: journeyDate, journeyPoints, dayPoints, normalizeJourney, addJourneyWin, getJourney
};
