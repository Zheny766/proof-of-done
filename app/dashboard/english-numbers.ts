// The site is in English, but AG Studio and its charts format numbers and dates with the browser's
// locale (Intl.NumberFormat(undefined, ...)), and there's no option to change that. In a Russian
// browser the dashboard read "$1 746", "46,04" and "4 тыс." next to English labels. Here, a call
// that names no locale gets en-US, the format the rest of the site already uses; one that names a
// locale keeps it. Studio builds some formatters when it loads, so dashboard.tsx imports this
// file before ag-studio and it runs on import.

const EN = 'en-US';

function pin<T extends abstract new (...args: never[]) => unknown>(Native: T): T {
  const Pinned = function (locales?: Intl.LocalesArgument, options?: object) {
    return new (Native as unknown as new (l: Intl.LocalesArgument, o?: object) => unknown)(locales ?? EN, options);
  } as unknown as T;
  Object.setPrototypeOf(Pinned, Native);
  (Pinned as unknown as { prototype: unknown }).prototype = Native.prototype;
  return Pinned;
}

if (typeof window !== 'undefined' && !(Intl as { pinnedToEnglish?: true }).pinnedToEnglish) {
  (Intl as { pinnedToEnglish?: true }).pinnedToEnglish = true;
  Intl.NumberFormat = pin(Intl.NumberFormat);
  Intl.DateTimeFormat = pin(Intl.DateTimeFormat);
  const number = Number.prototype.toLocaleString;
  Number.prototype.toLocaleString = function (locales?: Intl.LocalesArgument, options?: Intl.NumberFormatOptions) {
    return number.call(this, locales ?? EN, options);
  };
  for (const key of ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString'] as const) {
    const date = Date.prototype[key];
    Date.prototype[key] = function (locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
      return date.call(this, locales ?? EN, options);
    };
  }
}
