// Placeholder parameter mapping and setter
export function onParamChange(path: string, value: number) {
  // TODO: wire to Tauri engine via invoke('set_param', ...)
  // eslint-disable-next-line no-console
  console.log('[param]', path, value);
}

