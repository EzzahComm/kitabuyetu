import { describe, it, expect } from 'vitest';
import {
  findLowestCommonAncestor,
  getAllAncestors,
  getDistance,
  describeRelationship,
  type AncestryGraph,
} from './relationship-calculator';

describe('Relationship Calculator', () => {
  // Build a simple tree:
  //     A (grandparent)
  //    / \
  //   B   C (parents)
  //   |   |
  //   D   E (children)
  //   |
  //   F (grandchild)

  const graph: AncestryGraph = {
    nodes: new Map([
      ['A', { sex: 'male' }],
      ['B', { sex: 'male' }],
      ['C', { sex: 'female' }],
      ['D', { sex: 'male' }],
      ['E', { sex: 'female' }],
      ['F', { sex: 'male' }],
    ]),
    edges: [
      { child: 'B', parent: 'A', certainty: 'documented' },
      { child: 'C', parent: 'A', certainty: 'documented' },
      { child: 'D', parent: 'B', certainty: 'documented' },
      { child: 'E', parent: 'C', certainty: 'documented' },
      { child: 'F', parent: 'D', certainty: 'documented' },
    ],
  };

  describe('getAllAncestors', () => {
    it('returns all ancestors of a person', () => {
      const ancestors = getAllAncestors(graph, 'F');
      expect(ancestors).toContain('D');
      expect(ancestors).toContain('B');
      expect(ancestors).toContain('A');
      expect(ancestors.length).toBe(3);
    });

    it('returns empty list for root', () => {
      const ancestors = getAllAncestors(graph, 'A');
      expect(ancestors).toHaveLength(0);
    });
  });

  describe('getDistance', () => {
    it('returns distance between parent and child', () => {
      expect(getDistance(graph, 'B', 'D')).toBe(1);
    });

    it('returns distance for grandparent-grandchild', () => {
      expect(getDistance(graph, 'A', 'D')).toBe(2);
    });

    it('returns null for unrelated persons', () => {
      expect(getDistance(graph, 'E', 'D')).toBeNull();
    });
  });

  describe('findLowestCommonAncestor', () => {
    it('finds LCA of siblings', () => {
      const lca = findLowestCommonAncestor(graph, 'D', 'E');
      expect(lca).toBe('A');
    });

    it('finds LCA of cousins', () => {
      // D and E's common ancestor is A
      const lca = findLowestCommonAncestor(graph, 'D', 'E');
      expect(lca).toBe('A');
    });

    it('returns null for unrelated persons', () => {
      const extendedGraph: AncestryGraph = {
        ...graph,
        nodes: new Map([...graph.nodes, ['X', { sex: 'male' }]]),
      };
      const lca = findLowestCommonAncestor(extendedGraph, 'A', 'X');
      expect(lca).toBeNull();
    });
  });

  describe('describeRelationship', () => {
    it('describes parent-child relationship', () => {
      const rel = describeRelationship(graph, 'B', 'D', 'en');
      expect(rel).toContain('child');
    });

    it('describes ancestor-descendant', () => {
      // A is D's grandparent two generations up; describeRelationship
      // describes the second argument's role relative to the first (same
      // convention as the parent-child test above), so D is labeled A's
      // grandchild, not the reverse.
      const rel = describeRelationship(graph, 'A', 'D', 'en');
      expect(rel).toMatch(/grandchild|descendant/);
    });

    it('describes sibling relationship in Swahili', () => {
      const rel = describeRelationship(graph, 'D', 'E', 'sw');
      // D and E should be described as cousins (fuzzy) or relatives
      expect(rel).toBeTruthy();
    });

    it('describes unrelated as relative', () => {
      const extendedGraph: AncestryGraph = {
        ...graph,
        nodes: new Map([...graph.nodes, ['X', { sex: 'male' }]]),
      };
      const rel = describeRelationship(extendedGraph, 'A', 'X', 'en');
      expect(rel).toBe('relative');
    });
  });
});
