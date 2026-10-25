// URL のパラメータ（/scene/:id など）を正の整数の ID として読み取る（形式が違う場合は null）
export function parseId(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
