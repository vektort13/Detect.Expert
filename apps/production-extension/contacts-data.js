// Owner-provided destinations; these links are not fetched by the workspace.
const entry = (id, group, label, href, icon, color, language = null) => Object.freeze({ id, group, label, href, icon, color, language });
export const CONTACT_LINKS = Object.freeze([
  entry('detect', 'sites', 'proxyCards', 'https://detect.expert/', 'detect', 'blue'),
  entry('anti-bot', 'sites', 'userId', 'https://anti.bot/', 'identity', 'violet'),
  entry('antidetect', 'sites', 'antidetect', 'https://antidetect.com/', 'fingerprint', 'indigo'),
  entry('grid', 'sites', 'training', 'https://grid.training/', 'education', 'amber'),
  entry('euqlid', 'sites', 'wifiMap', 'https://euqlid.space/', 'wifi', 'teal'),
  entry('telegram-main', 'social', 'mainGroup', 'https://t.me/antidetect', 'telegram', 'blue'),
  entry('telegram-ru', 'social', 'russianChat', 'https://t.me/antidetectchat', 'telegram', 'blue'),
  entry('telegram-en', 'social', 'englishChat', 'https://t.me/multiacceng', 'telegram', 'blue'),
  entry('discord', 'social', 'discordChat', 'https://discord.gg/6pENTcY7Zc', 'discord', 'indigo'),
  entry('github', 'social', 'github', 'https://github.com/vektort13', 'github', 'slate'),
  entry('youtube-ru', 'social', 'YouTube', 'https://www.youtube.com/@VektorT13', 'youtube', 'rose', Object.freeze({ name: 'Русский', flag: 'ru' })),
  entry('youtube-en', 'social', 'YouTube', 'https://www.youtube.com/@VektorT13ENG', 'youtube', 'rose', Object.freeze({ name: 'English', flag: 'gb' })),
  entry('youtube-vi', 'social', 'YouTube', 'https://www.youtube.com/@VektorT13VN', 'youtube', 'rose', Object.freeze({ name: 'Tiếng Việt', flag: 'vn' })),
  entry('youtube-zh', 'social', 'YouTube', 'https://www.youtube.com/@VektorT13CN', 'youtube', 'rose', Object.freeze({ name: '中文', flag: 'cn' })),
  entry('youtube-es', 'social', 'YouTube', 'https://www.youtube.com/@VektorT13ES', 'youtube', 'rose', Object.freeze({ name: 'Español', flag: 'es' })),
]);
