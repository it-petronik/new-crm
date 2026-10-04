export type DeviceInputKind = "audioinput" | "videoinput";
export const DEVICE_NOUN: Record<DeviceInputKind, string> = { audioinput: "microphone", videoinput: "camera" };

export function cleanLabel(label: string) {
  return label
    .replace(/^(Default|Communications)\s*-\s*/i, "")
    .replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Friendly device labels, independent of the UI and its stylesheet loader. */
export function deviceOptions(devices: MediaDeviceInfo[], kind: DeviceInputKind) {
  const real = devices.filter((d) => d.kind === kind && d.deviceId && d.deviceId !== "communications");
  let n = 0;
  return real.map((d) => {
    const clean = cleanLabel(d.label);
    if (d.deviceId === "default") return { id: d.deviceId, label: clean ? `System default (${clean})` : `Default ${DEVICE_NOUN[kind]}` };
    n += 1;
    return { id: d.deviceId, label: clean || (n === 1 ? `Default ${DEVICE_NOUN[kind]}` : `${DEVICE_NOUN[kind][0].toUpperCase()}${DEVICE_NOUN[kind].slice(1)} ${n}`) };
  });
}
