export function attachedAndroidSerials(output) {
  return String(output)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("List of devices attached"))
    .map((line) => line.split(/\s+/u))
    .filter((fields) => fields.length >= 2)
    .map(([serial, status]) => ({ serial, status }))
    .filter(({ serial }) => Boolean(serial));
}
