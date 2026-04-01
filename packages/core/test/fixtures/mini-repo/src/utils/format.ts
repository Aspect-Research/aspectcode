export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function slugify(str: string): string {
  return str.toLowerCase().replace(/\s+/g, '-');
}
