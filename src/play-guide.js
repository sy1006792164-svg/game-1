'use strict';

// Show only the rule that matters at the current point in the real route.
function playHint(game, now) {
  const l = game.level, s = game.state;
  if (!l || !s) return '';
  if (game.reviewing) return game.failureHint();
  if (s.status === 'won') return '信已送达。';
  if (s.status === 'failed') return '灯火已耗尽。' + game.failureHint();
  if (game.blockedAt != null && now - game.blockedAt < 1400) return '这边不通，点亮起的相邻地砖试试。';
  if (!s.letters.length && !s.seals.length) return '收集完成，' + (s.energy <= 3 ? '只剩 ' + s.energy + ' 拍，' : '') + '前往亮起的邮局。';
  const lowLight = s.energy <= 3 ? '只剩 ' + s.energy + ' 拍。' : '';
  const recent = s.history.slice(-3);
  const nextEcho = s.turn >= 2 ? s.history[s.turn - 2] : null;
  if (nextEcho != null && s.seals.includes(nextEcho)) return lowLight + '下一步回声会收起蓝票，移动或等一拍都可以。';
  if (!s.letters.length && s.seals.every(cell => recent.includes(cell))) {
    return lowLight + (s.player === l.exit ? '已到邮局，等待回声收齐剩余蓝票。' : '蓝票已在回声路上，向邮局走或等一拍。');
  }
  if (lowLight) return lowLight + '移动和等待都会耗灯；留好回邮局的路。';
  if (s.turn === 0) {
    if (l.id <= 3) return '点亮起的相邻地砖移动，先走过蓝票。';
    if ((l.bridges || []).length) return '纸桥离开后就会碎，先想好哪一段只走一次。';
    if (l.lights.length) return '沿路的风灯可以补 3 拍，收信时顺路点亮。';
    if (Object.keys(l.winds).length) return '箭头会再推你一格，留意实际落点。';
    return '收橙色信笺，让晚三拍的回声收蓝票。';
  }
  if (s.turn < 3 && recent.some(cell => s.seals.includes(cell))) return '你已经过蓝票，再走 ' + (3 - s.turn + recent.findIndex(cell => s.seals.includes(cell))) + ' 拍，回声就会到达。';
  if (!s.seals.length) return '蓝票已齐，收好剩余信笺再回邮局。';
  return nextEcho != null ? '蓝色光环是回声下一步的位置。' : '先走过蓝票，再沿路收橙色信笺。';
}

module.exports = { playHint };
