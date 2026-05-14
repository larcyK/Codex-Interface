const STORAGE_KEY_ACCESS_TOKEN = "codex_access_token";
const STORAGE_KEY_REFRESH_TOKEN = "codex_refresh_token";
const STORAGE_KEY_DEVICE_ID = "codex_device_id";
export function saveTokens(accessToken, refreshToken, deviceId) {
    if (typeof localStorage !== "undefined") {
        localStorage.setItem(STORAGE_KEY_ACCESS_TOKEN, accessToken);
        localStorage.setItem(STORAGE_KEY_REFRESH_TOKEN, refreshToken);
        localStorage.setItem(STORAGE_KEY_DEVICE_ID, deviceId);
    }
}
export function getTokens() {
    if (typeof localStorage === "undefined") {
        return { accessToken: null, refreshToken: null, deviceId: null };
    }
    return {
        accessToken: localStorage.getItem(STORAGE_KEY_ACCESS_TOKEN),
        refreshToken: localStorage.getItem(STORAGE_KEY_REFRESH_TOKEN),
        deviceId: localStorage.getItem(STORAGE_KEY_DEVICE_ID),
    };
}
export function clearTokens() {
    if (typeof localStorage !== "undefined") {
        localStorage.removeItem(STORAGE_KEY_ACCESS_TOKEN);
        localStorage.removeItem(STORAGE_KEY_REFRESH_TOKEN);
        localStorage.removeItem(STORAGE_KEY_DEVICE_ID);
    }
}
