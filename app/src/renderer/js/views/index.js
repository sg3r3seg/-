import dashboard from './dashboard.js';
import account from './account.js';
import connections from './connections.js';
import { tts, voiceStudio } from './tts.js';
import { alerts, chatbot, commands } from './live.js';
import { soundboard, macro, remote } from './control.js';
import { timer, challenges, giveaway } from './engage.js';
import { overlayEditor, overlayCenter } from './overlays.js';
import { schedule, community, highlights, analytics } from './insights.js';
import { performance, diagnostics, settings } from './system.js';

// ent: required entitlement (null = available to every signed-in user).
export const VIEWS = [
  { id: 'dashboard', group: 'main', icon: 'dashboard', title: 'nav_dashboard', ent: null, render: dashboard },
  { id: 'account', group: 'main', icon: 'key', title: 'nav_account', ent: null, render: account },
  { id: 'connections', group: 'main', icon: 'plug', title: 'nav_connections', ent: null, render: connections },
  { id: 'tts', group: 'voice', icon: 'mic', title: 'nav_tts', ent: 'tts', render: tts },
  { id: 'voice-studio', group: 'voice', icon: 'wave', title: 'nav_voice_studio', ent: 'tts', render: voiceStudio },
  { id: 'alerts', group: 'live', icon: 'bell', title: 'nav_alerts', ent: 'pro', render: alerts },
  { id: 'chatbot', group: 'live', icon: 'bot', title: 'nav_chatbot', ent: 'pro', render: chatbot },
  { id: 'commands', group: 'live', icon: 'terminal', title: 'nav_commands', ent: 'pro', render: commands },
  { id: 'soundboard', group: 'live', icon: 'music', title: 'nav_soundboard', ent: 'pro', render: soundboard },
  { id: 'macro', group: 'live', icon: 'zap', title: 'nav_macro', ent: 'pro', render: macro },
  { id: 'remote', group: 'live', icon: 'phone', title: 'nav_remote', ent: 'pro', render: remote },
  { id: 'timer', group: 'engage', icon: 'timer', title: 'nav_timer', ent: 'pro', render: timer },
  { id: 'challenges', group: 'engage', icon: 'trophy', title: 'nav_challenges', ent: 'pro', render: challenges },
  { id: 'giveaway', group: 'engage', icon: 'gift', title: 'nav_giveaway', ent: 'pro', render: giveaway },
  { id: 'overlay-editor', group: 'overlays', icon: 'palette', title: 'nav_overlay_editor', ent: 'pro', render: overlayEditor },
  { id: 'overlay-center', group: 'overlays', icon: 'layers', title: 'nav_overlay_center', ent: null, render: overlayCenter },
  { id: 'schedule', group: 'grow', icon: 'calendar', title: 'nav_schedule', ent: 'pro', render: schedule },
  { id: 'community', group: 'grow', icon: 'users', title: 'nav_community', ent: 'pro', render: community },
  { id: 'highlights', group: 'grow', icon: 'star', title: 'nav_highlights', ent: 'pro', render: highlights },
  { id: 'analytics', group: 'grow', icon: 'chart', title: 'nav_analytics', ent: 'pro', render: analytics },
  { id: 'performance', group: 'system', icon: 'gauge', title: 'nav_performance', ent: 'pro', render: performance },
  { id: 'diagnostics', group: 'system', icon: 'stetho', title: 'nav_diagnostics', ent: null, render: diagnostics },
  { id: 'settings', group: 'system', icon: 'settings', title: 'nav_settings', ent: null, render: settings },
];
export const GROUPS = ['main', 'voice', 'live', 'engage', 'overlays', 'grow', 'system'];
