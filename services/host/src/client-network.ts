import { isIPv6 } from "node:net";

const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

function hextets(part: string): string[] {
  if (part === "") {
    return [];
  }
  // An embedded IPv4 tail (for example 64:ff9b::192.0.2.1) fills two hextets.
  return part.split(":").flatMap((group) => (group.includes(".") ? ["0", "0"] : [group]));
}

/**
 * The key that the per-client limits (the global request cap and the login
 * lockout) count against. An IPv4 client is its own address. An IPv6 client is
 * its /64 network, because one host normally holds a whole /64 and can pick a
 * new address in it for each request. An IPv4-mapped IPv6 address counts as the
 * IPv4 address it carries.
 */
export function clientNetworkKey(ip: string): string {
  const mapped = IPV4_MAPPED.exec(ip);
  if (mapped !== null && mapped[1] !== undefined) {
    return mapped[1];
  }
  if (!isIPv6(ip)) {
    return ip;
  }
  const address = ip.split("%", 1)[0] ?? ip;
  const [head = "", tail] = address.split("::");
  const headGroups = hextets(head);
  const tailGroups = tail === undefined ? [] : hextets(tail);
  const groups =
    tail === undefined
      ? headGroups
      : [...headGroups, ...Array<string>(8 - headGroups.length - tailGroups.length).fill("0"), ...tailGroups];
  const prefix = groups.slice(0, 4).map((group) => Number.parseInt(group, 16).toString(16));
  return `${prefix.join(":")}::/64`;
}
