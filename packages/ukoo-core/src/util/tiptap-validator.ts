// Spec §6.1: Tiptap content validation
// Allowed node types: paragraph, h2, h3, blockquote, bulletList, orderedList
// Allowed marks: bold, italic, link
// Special: personLink, citation, mediaEmbed, bioSectionHeading

export interface TiptapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  text?: string;
}

const ALLOWED_NODE_TYPES = new Set([
  'doc',
  'paragraph',
  'text',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'blockquote',
  'personLink',
  'citation',
  'mediaEmbed',
  'bioSectionHeading',
]);

const ALLOWED_MARKS = new Set(['bold', 'italic', 'link']);

export interface ValidationError {
  path: string;
  message: string;
}

export function validateTiptapContent(content: TiptapNode): ValidationError[] {
  const errors: ValidationError[] = [];
  validateNode(content, 'root', errors);
  return errors;
}

function validateNode(node: TiptapNode, path: string, errors: ValidationError[]): void {
  if (!ALLOWED_NODE_TYPES.has(node.type)) {
    errors.push({ path, message: `Disallowed node type: ${node.type}` });
    return;
  }

  // Heading validation: only h2, h3
  if (node.type === 'heading') {
    const level = node.attrs?.level;
    if (level !== 2 && level !== 3) {
      errors.push({ path, message: `Heading level must be 2 or 3, got ${level}` });
    }
  }

  // Link validation
  if (node.type === 'personLink' && !node.attrs?.personId) {
    errors.push({ path, message: 'personLink requires personId attribute' });
  }

  if (node.marks) {
    node.marks.forEach((mark, i) => {
      if (!ALLOWED_MARKS.has(mark.type)) {
        errors.push({ path: `${path}/mark[${i}]`, message: `Disallowed mark: ${mark.type}` });
      }
    });
  }

  if (node.content) {
    node.content.forEach((child, i) => {
      validateNode(child, `${path}/content[${i}]`, errors);
    });
  }
}
