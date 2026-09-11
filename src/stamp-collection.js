'use strict';

const FILTERS = Object.freeze([
  Object.freeze({ id: 'all', label: '全部' }),
  Object.freeze({ id: 'owned', label: '已收藏' }),
  Object.freeze({ id: 'locked', label: '待收藏' })
]);

function collectionFilter(game) {
  return FILTERS.some(filter => filter.id === game.collectionFilter) ? game.collectionFilter : 'all';
}

function visibleStamps(game, album = game.album()) {
  const filter = collectionFilter(game);
  return album.stamps.filter(stamp => filter === 'all' || stamp.owned === (filter === 'owned'));
}

function setCollectionFilter(game, filter) {
  if (game.page !== 'collection' || game.busy || game.hidden || game.modal || !FILTERS.some(item => item.id === filter)) return false;
  game.collectionFilter = filter;
  game.pointer = null; game.renderer.hits = [];
  game.collectionScroll.reset(game.platform.now());
  return true;
}

module.exports = { FILTERS, collectionFilter, visibleStamps, setCollectionFilter };
