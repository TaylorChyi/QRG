import en from '../../locales/en.json';
import zhTW from '../../locales/zh-TW.json';
import ja from '../../locales/ja.json';
import ko from '../../locales/ko.json';
import es from '../../locales/es.json';
import fr from '../../locales/fr.json';
import de from '../../locales/de.json';

const catalogues = { 'zh-CN': {}, 'zh-TW': zhTW, en, ja, ko, es, fr, de };

export function resolveLocale(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const tag = value.trim().replaceAll('_', '-').split(/[.@]/, 1)[0].toLowerCase();
  const [language, ...parts] = tag.split('-');
  if (language === 'zh') {
    if (parts.includes('hans')) return 'zh-CN';
    if (parts.includes('hant') || parts.some(part => ['tw', 'hk', 'mo'].includes(part))) return 'zh-TW';
    return 'zh-CN';
  }
  return Object.hasOwn(catalogues, language) ? language : null;
}

export function chooseLocale(preference, languages) {
  return resolveLocale(preference) || languages.map(resolveLocale).find(Boolean) || 'zh-CN';
}

export function catalogue(locale) {
  return catalogues[resolveLocale(locale) || 'zh-CN'];
}

export function translator(locale) {
  const messages = catalogue(locale);
  return (source, values = {}) => (messages[source] || source).replace(/\{(\w+)\}/g,
    (match, key) => Object.hasOwn(values, key) ? String(values[key]) : match);
}
