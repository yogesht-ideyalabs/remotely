// Minimal IPv4 CIDR matcher (no deps). Loopback IPv6 forms are normalized
// to 127.0.0.1 so CIDR rules like "127.0.0.0/8" work against a browser
// hitting the control plane over localhost during local testing.
function normalize(ip: string): string {
  if (ip === "::1") return "127.0.0.1";
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? mapped[1] : ip;
}

function ipToInt(ip: string): number | null {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

export function ipInCidr(rawIp: string, cidr: string): boolean {
  const ip = normalize(rawIp);
  const [range, bitsStr] = cidr.split("/");
  const bits = bitsStr === undefined ? 32 : Number(bitsStr);
  const ipInt = ipToInt(ip);
  const rangeInt = ipToInt(range);
  if (ipInt === null || rangeInt === null) return false;
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xffffffff : (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}
