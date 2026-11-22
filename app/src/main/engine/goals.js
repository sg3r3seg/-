'use strict';
const { uid, clampStr, num } = require('./util');

const METRICS = ['follow', 'like', 'gift', 'diamonds', 'sub', 'share', 'chat', 'superchat'];
function amountFor(metric, e) {
  switch (metric) {
    case 'follow': return e.type === 'follow' ? 1 : 0;
    case 'like': return e.type === 'like' ? e.count || 1 : 0;
    case 'gift': return e.type === 'gift' ? e.count || 1 : 0;
    case 'diamonds': return e.type === 'gift' && e.currency === 'diamonds' ? e.amount || 0 : 0;
    case 'sub': return e.type === 'sub' ? 1 : 0;
    case 'share': return e.type === 'share' ? 1 : 0;
    case 'chat': return e.type === 'chat' ? 1 : 0;
    case 'superchat': return e.type === 'superchat' ? 1 : 0;
    default: return 0;
  }
}

// FOLLOWER GOAL overlay + CHALLENGES, both driven by real events.
module.exports = (ctx) => {
  let goal = { title: 'Follower goal', metric: 'follow', target: 100, current: 0, ...ctx.store.get('goal', {}) };
  let challenges = ctx.store.get('challenges', []);
  const pushGoal = () => { ctx.store.set('goal', goal); ctx.overlay.broadcast('follower-goal', 'state', goal, { sticky: true }); ctx.send('goal:state', goal); return goal; };
  const pushCh = () => { ctx.store.set('challenges', challenges); ctx.send('challenges:state', challenges); return challenges; };
  return {
    METRICS,
    goal: () => goal,
    saveGoal(g) { goal = { title: clampStr(g.title, 60), metric: METRICS.includes(g.metric) ? g.metric : 'follow', target: num(g.target, 100, 1, 1e9), current: num(g.current, goal.current, 0, 1e9) }; return pushGoal(); },
    challenges: () => challenges,
    saveChallenge(c) {
      const item = { id: clampStr(c.id || uid(), 20), title: clampStr(c.title, 80), reward: clampStr(c.reward, 120), metric: METRICS.includes(c.metric) ? c.metric : 'gift', target: num(c.target, 10, 1, 1e9), progress: num(c.progress, 0, 0, 1e9), active: c.active !== false, completedAt: c.completedAt || null };
      challenges = [...challenges.filter((x) => x.id !== item.id), item];
      return pushCh();
    },
    deleteChallenge(id) { challenges = challenges.filter((x) => x.id !== id); return pushCh(); },
    resetChallenge(id) { challenges = challenges.map((x) => (x.id === id ? { ...x, progress: 0, completedAt: null, active: true } : x)); return pushCh(); },
    onEvent(e) {
      if (e.test || !ctx.session.has('pro')) return;
      const ga = amountFor(goal.metric, e);
      if (ga) { goal.current += ga; pushGoal(); }
      let changed = false;
      for (const c of challenges) {
        if (!c.active || c.completedAt) continue;
        const a = amountFor(c.metric, e);
        if (!a) continue;
        c.progress = Math.min(c.target, c.progress + a); changed = true;
        if (c.progress >= c.target) {
          c.completedAt = Date.now();
          ctx.alerts.showText(`🏆 ${c.title}${c.reward ? ` — ${c.reward}` : ''}`, 8000);
          ctx.activity({ kind: 'challenge', text: `Challenge completed: ${c.title}` });
        }
      }
      if (changed) pushCh();
    },
  };
};
