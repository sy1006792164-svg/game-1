'use strict';

const config = require('./config');

const HEALTH_ADVICE_TITLE = '健康游戏忠告';
const HEALTH_ADVICE_LINES = Object.freeze([
  '抵制不良游戏，拒绝盗版游戏。',
  '注意自我保护，谨防受骗上当。',
  '适度游戏益脑，沉迷游戏伤身。',
  '合理安排时间，享受健康生活。'
]);

// Progress follows completed preparation tasks; animation never overtakes real work.
// Each update starts at most one task, leaving a paint opportunity between stages.
class StartupLoader {
  constructor(tasks) {
    this.tasks = tasks; this.completed = 0; this.progress = 0;
    this.pending = false; this.error = null; this.settledMs = 0;
  }
  get label() {
    if (this.progress === 1) return '加载完成';
    const task = this.tasks[this.completed];
    return task ? task.label : '正在准备回廊';
  }
  get ready() {
    return !this.error && !this.pending && this.completed === this.tasks.length && this.progress === 1 && this.settledMs >= 180;
  }
  update(deltaMs) {
    if (this.error || this.ready) return;
    const dt = Number.isFinite(deltaMs) ? Math.max(0, Math.min(100, deltaMs)) : 0;
    const wasFull = this.progress === 1;
    if (!this.pending && this.completed < this.tasks.length) {
      try {
        const result = this.tasks[this.completed].run();
        if (result && typeof result.then === 'function') {
          this.pending = true;
          Promise.resolve(result).then(() => { this.pending = false; this.completed++; }, error => {
            this.pending = false; this.error = error || new Error('Startup preparation failed');
          });
        } else this.completed++;
      } catch (error) { this.error = error || new Error('Startup preparation failed'); }
    }
    const target = this.tasks.length ? this.completed / this.tasks.length : 1;
    this.progress = Math.min(target, this.progress + dt / 900);
    if (this.progress > 1 - 1e-9) this.progress = 1;
    if (wasFull && this.progress === 1) this.settledMs += dt;
  }
  retry() { this.error = null; }
}

function publicationLines(info = config.PUBLICATION_INFO) {
  const fields = [
    ['copyrightHolder', '著作权人'], ['publisher', '出版服务单位'],
    ['approvalNumber', '批准文号'], ['publicationNumber', '出版物号（ISBN）']
  ];
  return fields.flatMap(([key, label]) => {
    const value = info && typeof info[key] === 'string' ? info[key].trim() : '';
    return value ? [{ label, value }] : [];
  });
}

module.exports = { HEALTH_ADVICE_TITLE, HEALTH_ADVICE_LINES, publicationLines, StartupLoader };
