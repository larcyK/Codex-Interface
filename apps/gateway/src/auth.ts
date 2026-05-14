import { createHash, randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";

const DEFAULT_SECRET = "dev-only-change-this-secret";
const encoder = new TextEncoder();

export const hashPin = (pin: string): string =>
  createHash("sha256").update(pin).digest("hex");

export const verifyPin = (pin: string, hash: string): boolean =>
  hashPin(pin) === hash;

export interface AccessTokenPayload {
  sub: string;
  deviceName: string;
  scope: "exec";
}

export async function issueAccessToken(
  payload: AccessTokenPayload,
  expiresInSec = 900,
  secret = DEFAULT_SECRET,
): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime(`${expiresInSec}s`)
    .sign(encoder.encode(secret));
}

export async function verifyAccessToken(
  token: string,
  secret = DEFAULT_SECRET,
): Promise<AccessTokenPayload> {
  const { payload } = await jwtVerify(token, encoder.encode(secret));
  return {
    sub: String(payload.sub ?? ""),
    deviceName: String(payload.deviceName ?? ""),
    scope: "exec",
  };
}

export const issueRefreshToken = (): string => randomUUID();
