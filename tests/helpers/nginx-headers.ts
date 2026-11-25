// The browser tests serve the admin with the headers of the deployed nginx.
// `add_header` values may name a `map $uri` variable; this resolves them per
// path the way nginx does (exact key, then regex in order, then default) and
// drops empty values, which nginx does not send.
export function nginxHeaders(config: string) {
  const maps = new Map<string, { key: string; value: string }[]>();
  for (const [, name, body] of config.matchAll(
    /map \$uri \$(\w+) \{([^}]+)\}/g,
  ))
    maps.set(
      name!,
      [...body!.matchAll(/^\s*(\S+)\s+(?:"([^"]*)"|(\S*));/gm)].map((m) => ({
        key: m[1]!,
        value: m[2] ?? m[3]!,
      })),
    );
  const resolve = (name: string, uri: string) => {
    const entries = maps.get(name);
    if (!entries) throw new Error('nginx.conf has no map for $' + name);
    const match =
      entries.find((e) => e.key === uri) ??
      entries.find(
        (e) =>
          e.key.startsWith('~') &&
          new RegExp(
            e.key.replace(/^~\*?/, ''),
            e.key.startsWith('~*') ? 'i' : '',
          ).test(uri),
      ) ??
      entries.find((e) => e.key === 'default');
    return match?.value ?? '';
  };
  const headers = [
    ...config.matchAll(/add_header ([\w-]+) (?:"([^"]+)"|([^; ]+)) always;/g),
  ].map((m) => ({ name: m[1]!, value: m[2] ?? m[3]! }));
  return (url: string) => {
    const uri = new URL(url, 'https://localhost').pathname;
    return Object.fromEntries(
      headers
        .map(({ name, value }) => [
          name,
          value.replace(/\$(\w+)/g, (_, variable: string) =>
            resolve(variable, uri),
          ),
        ])
        .filter(([, value]) => value !== ''),
    ) as Record<string, string>;
  };
}
