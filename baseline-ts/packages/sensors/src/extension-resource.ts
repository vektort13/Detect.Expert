const NativeURL = URL;
const apply = Reflect.apply;
const startsWith = String.prototype.startsWith;
const regexpExec = RegExp.prototype.exec;
const idPattern = /^[a-p]{32}$/;
const protocol = Object.getOwnPropertyDescriptor(NativeURL.prototype, 'protocol')!.get!;
const hostname = Object.getOwnPropertyDescriptor(NativeURL.prototype, 'hostname')!.get!;
const username = Object.getOwnPropertyDescriptor(NativeURL.prototype, 'username')!.get!;
const password = Object.getOwnPropertyDescriptor(NativeURL.prototype, 'password')!.get!;
const port = Object.getOwnPropertyDescriptor(NativeURL.prototype, 'port')!.get!;

export function extensionResourceId(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 4096 || !apply(startsWith, input, ['chrome-extension://'])) return null;
  try {
    const parsed = new NativeURL(input);
    const id = apply(hostname, parsed, []) as string;
    return apply(protocol, parsed, []) === 'chrome-extension:' && !apply(username, parsed, []) &&
      !apply(password, parsed, []) && !apply(port, parsed, []) && apply(regexpExec, idPattern, [id]) !== null ? id : null;
  } catch { return null; }
}