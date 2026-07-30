/** Replace {{var}} placeholders with values; unknown vars become ''. */
export function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) =>
    key in vars ? vars[key]! : '',
  );
}
