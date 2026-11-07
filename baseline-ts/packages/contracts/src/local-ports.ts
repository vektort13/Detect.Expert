export const REQUESTED_LOCAL_PORTS_LIMIT = 128;

export interface RequestedLocalPorts {
  ports: number[];
  truncated: boolean;
}

export function readRequestedLocalPorts(value: unknown): RequestedLocalPorts | null {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value) || Reflect.ownKeys(value).length !== 2) return null;
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const portsField = Object.getOwnPropertyDescriptor(value, 'ports');
    const truncatedField = Object.getOwnPropertyDescriptor(value, 'truncated');
    if (!portsField?.enumerable || !Object.hasOwn(portsField, 'value') || !truncatedField?.enumerable ||
        !Object.hasOwn(truncatedField, 'value') || typeof truncatedField.value !== 'boolean') return null;
    const values: unknown = portsField.value;
    if (!Array.isArray(values) || Object.getPrototypeOf(values) !== Array.prototype ||
        values.length > REQUESTED_LOCAL_PORTS_LIMIT || Reflect.ownKeys(values).length !== values.length + 1) return null;
    const ports: number[] = [];
    const seen = new Set<number>();
    for (let index = 0; index < values.length; index++) {
      const field = Object.getOwnPropertyDescriptor(values, String(index));
      if (!field?.enumerable || !Object.hasOwn(field, 'value')) return null;
      const port: unknown = field.value;
      if (typeof port !== 'number' || !Number.isInteger(port) || port < 0 || port > 65535 || seen.has(port) || Object.is(port, -0)) return null;
      ports.push(port);
      seen.add(port);
    }
    ports.sort((first, second) => first - second);
    return { ports, truncated: truncatedField.value as boolean };
  } catch { return null; }
}