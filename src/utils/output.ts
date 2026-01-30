import { AppError } from './errors.ts';

export type JsonResult =
  | { success: true; data?: Record<string, unknown> }
  | { success: false; error: { code: string; message: string; details?: Record<string, unknown> } };

export function printJson(result: JsonResult): void {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export function printHumanError(err: AppError): void {
  const details = err.details ? `\n${JSON.stringify(err.details, null, 2)}` : '';
  process.stderr.write(`Error (${err.code}): ${err.message}${details}\n`);
}

type SnapshotRect = { x: number; y: number; width: number; height: number };
type SnapshotNode = {
  ref?: string;
  depth?: number;
  type?: string;
  label?: string;
  value?: string;
  identifier?: string;
  rect?: SnapshotRect;
  hittable?: boolean;
  enabled?: boolean;
};

export function formatSnapshotText(
  data: Record<string, unknown>,
  options: { raw?: boolean } = {},
): string {
  const nodes = (data.nodes ?? []) as SnapshotNode[];
  const truncated = Boolean(data.truncated);
  const header = `Snapshot: ${nodes.length} nodes${truncated ? ' (truncated)' : ''}`;
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return `${header}\n`;
  }
  if (options.raw) {
    const rawLines = nodes.map((node) => JSON.stringify(node));
    return `${header}\n${rawLines.join('\n')}\n`;
  }
  const lines = nodes.map((node) => {
    const depth = node.depth ?? 0;
    const indent = '  '.repeat(Math.max(0, depth));
    const label = node.label?.trim() || node.value?.trim() || node.identifier?.trim() || '';
    const type = formatRole(node.type ?? 'Element');
    const ref = node.ref ? `@${node.ref}` : '';
    const rect = node.rect
      ? ` [${Math.round(node.rect.x)},${Math.round(node.rect.y)} ${Math.round(
          node.rect.width,
        )}x${Math.round(node.rect.height)}]`
      : '';
    const flags = [
      node.hittable ? 'hittable' : null,
      node.enabled === false ? 'disabled' : null,
    ]
      .filter(Boolean)
      .join(', ');
    const flagText = flags ? ` (${flags})` : '';
    const textPart = label ? ` "${label}"` : '';
    return `${indent}${ref} ${type}${textPart}${rect}${flagText}`.trimEnd();
  });
  return `${header}\n${lines.join('\n')}\n`;
}

function formatRole(type: string): string {
  const normalized = type.replace(/XCUIElementType/gi, '').toLowerCase();
  switch (normalized) {
    case 'application':
      return 'application';
    case 'navigationbar':
      return 'navigation-bar';
    case 'tabbar':
      return 'tab-bar';
    case 'button':
      return 'button';
    case 'link':
      return 'link';
    case 'cell':
      return 'cell';
    case 'statictext':
      return 'text';
    case 'textfield':
      return 'text-field';
    case 'textview':
      return 'text-view';
    case 'switch':
      return 'switch';
    case 'slider':
      return 'slider';
    case 'image':
      return 'image';
    case 'table':
      return 'list';
    case 'collectionview':
      return 'collection';
    case 'searchfield':
      return 'search';
    case 'segmentedcontrol':
      return 'segmented-control';
    default:
      return normalized || 'element';
  }
}
