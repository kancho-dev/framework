export async function fetchJson(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`${url} failed: ${res.status}`);
  return res.json();
}
