import type { RelationshipInfo, ParentageCertainty } from '../types/index';

export interface AncestryGraph {
  nodes: Map<string, { sex: 'male' | 'female' | 'other' }>;
  edges: Array<{ child: string; parent: string; certainty: ParentageCertainty }>;
}

export function findLowestCommonAncestor(
  graph: AncestryGraph,
  a: string,
  b: string
): string | null {
  const ancestorsA = getAllAncestors(graph, a);
  const ancestorsB = getAllAncestors(graph, b);

  const common = ancestorsA.filter(id => ancestorsB.includes(id));
  if (common.length === 0) return null;

  // LCA is the one with maximum distance (most recent)
  return common.sort((x, y) => {
    const distX = getDistance(graph, a, x);
    const distY = getDistance(graph, a, y);
    return (distY ?? 0) - (distX ?? 0);
  })[0];
}

export function getAllAncestors(graph: AncestryGraph, personId: string): string[] {
  const ancestors: string[] = [];
  const queue: string[] = [personId];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const parents = graph.edges
      .filter(e => e.child === current)
      .map(e => e.parent);

    ancestors.push(...parents);
    queue.push(...parents);
  }

  return ancestors;
}

export function getDistance(graph: AncestryGraph, from: string, to: string): number | null {
  // `to` may be either an ancestor or a descendant of `from` — try walking up
  // via parent edges first, then down via child edges, since a single BFS
  // can't follow both without conflating unrelated branches of the tree.
  return bfsDistance(graph, from, to, 'up') ?? bfsDistance(graph, from, to, 'down');
}

function bfsDistance(
  graph: AncestryGraph,
  from: string,
  to: string,
  direction: 'up' | 'down'
): number | null {
  const queue: [string, number][] = [[from, 0]];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const [current, dist] = queue.shift()!;
    if (current === to) return dist;
    if (visited.has(current)) continue;
    visited.add(current);

    const next =
      direction === 'up'
        ? graph.edges.filter(e => e.child === current).map(e => e.parent)
        : graph.edges.filter(e => e.parent === current).map(e => e.child);
    queue.push(...next.map(n => [n, dist + 1] as [string, number]));
  }

  return null;
}

export function describeRelationship(
  graph: AncestryGraph,
  aId: string,
  bId: string,
  locale: 'en' | 'sw' = 'en'
): string {
  const aAncestors = getAllAncestors(graph, aId);
  const aDescendants = getAllDescendants(graph, aId);
  const bAncestors = getAllAncestors(graph, bId);
  const bDescendants = getAllDescendants(graph, bId);

  // Direct relationships. The returned word always describes bId's role
  // relative to aId ("bId is aId's ___"): if bId is aId's ancestor, bId gets
  // an ancestor-word (parent/grandparent); if aId is bId's ancestor, bId —
  // the descendant — gets a descendant-word (child/grandchild).
  if (aAncestors.includes(bId)) {
    const dist = getDistance(graph, bId, aId) || 1;
    return formatAncestralRelation(dist, 'ancestor', locale);
  }

  if (bAncestors.includes(aId)) {
    const dist = getDistance(graph, aId, bId) || 1;
    return formatAncestralRelation(dist, 'descendant', locale);
  }

  // Sibling/cousin
  const lca = findLowestCommonAncestor(graph, aId, bId);
  if (lca) {
    const distA = getDistance(graph, lca, aId) || 1;
    const distB = getDistance(graph, lca, bId) || 1;

    if (distA === 1 && distB === 1) {
      return locale === 'sw' ? 'mkubwa/mdogo' : 'sibling';
    }

    return locale === 'sw' ? `fuzzy (${distA}, ${distB})` : `cousin (${distA}, ${distB})`;
  }

  return locale === 'sw' ? 'muuongo' : 'relative';
}

function formatAncestralRelation(distance: number, direction: 'ancestor' | 'descendant', locale: 'en' | 'sw'): string {
  const en = {
    1: direction === 'ancestor' ? 'parent' : 'child',
    2: direction === 'ancestor' ? 'grandparent' : 'grandchild',
    3: direction === 'ancestor' ? 'great-grandparent' : 'great-grandchild',
  };
  const sw = {
    1: direction === 'ancestor' ? 'mzazi' : 'mwana',
    2: direction === 'ancestor' ? 'babu/bibi' : 'mjukuu',
    3: direction === 'ancestor' ? 'baba/mama mkubwa' : 'mjukuu mkubwa',
  };

  const labels = locale === 'sw' ? sw : en;
  return labels[distance as keyof typeof labels] || (locale === 'sw' ? 'ukoo' : 'ancestor');
}

function getAllDescendants(graph: AncestryGraph, personId: string): string[] {
  const descendants: string[] = [];
  const queue: string[] = [personId];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const children = graph.edges
      .filter(e => e.parent === current)
      .map(e => e.child);

    descendants.push(...children);
    queue.push(...children);
  }

  return descendants;
}
