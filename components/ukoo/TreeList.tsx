'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface TreeNode {
  id: string;
  displayName: string;
  sex: 'male' | 'female' | 'other';
  born?: { year: number; precision: string };
  died?: { year: number; precision: string };
  privacy: string;
}

interface TreeEdge {
  childId: string;
  parentId: string;
  kind: string;
}

interface TreeData {
  focus: string;
  nodes: TreeNode[];
  edges: TreeEdge[];
  view: string;
}

export default function TreeList({ spaceId, focusPersonId }: { spaceId: string; focusPersonId: string }) {
  const [treeData, setTreeData] = useState<TreeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set([focusPersonId]));

  useEffect(() => {
    async function fetchTree() {
      try {
        const res = await fetch(`/api/ukoo/tree?focus=${focusPersonId}&up=4&down=3`);
        const data = await res.json();
        setTreeData(data);
      } catch (err) {
        console.error('Failed to fetch tree:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchTree();
  }, [focusPersonId]);

  function toggleExpanded(nodeId: string) {
    const newExpanded = new Set(expandedIds);
    if (newExpanded.has(nodeId)) {
      newExpanded.delete(nodeId);
    } else {
      newExpanded.add(nodeId);
    }
    setExpandedIds(newExpanded);
  }

  function getChildren(parentId: string): TreeNode[] {
    if (!treeData) return [];
    const childIds = treeData.edges
      .filter(e => e.parentId === parentId)
      .map(e => e.childId);
    return treeData.nodes.filter(n => childIds.includes(n.id));
  }

  function getParents(childId: string): TreeNode[] {
    if (!treeData) return [];
    const parentIds = treeData.edges
      .filter(e => e.childId === childId)
      .map(e => e.parentId);
    return treeData.nodes.filter(n => parentIds.includes(n.id));
  }

  if (loading) return <div className="p-4">Loading...</div>;
  if (!treeData) return <div className="p-4">Failed to load tree</div>;

  const focusNode = treeData.nodes.find(n => n.id === focusPersonId);
  if (!focusNode) return <div className="p-4">Focus person not found</div>;

  const NodeItem = ({ node, depth = 0 }: { node: TreeNode; depth?: number }) => {
    const children = getChildren(node.id);
    const hasChildren = children.length > 0;
    const isExpanded = expandedIds.has(node.id);

    return (
      <div key={node.id} className="py-2">
        <div style={{ marginLeft: `${depth * 20}px` }} className="flex items-center gap-2">
          {hasChildren && (
            <button
              onClick={() => toggleExpanded(node.id)}
              className="w-6 p-1 text-center text-sm"
              aria-label={isExpanded ? 'Collapse' : 'Expand'}
            >
              {isExpanded ? '▼' : '▶'}
            </button>
          )}
          {!hasChildren && <div className="w-6" />}
          <Link href={`/p/${node.id}`} className="flex-1 font-medium hover:underline">
            {node.displayName}
          </Link>
          <span className="text-xs text-gray-600">{node.sex}</span>
        </div>

        {isExpanded && hasChildren && (
          <div>
            {children.map(child => (
              <NodeItem key={child.id} node={child} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="p-4 border rounded bg-white">
      <h2 className="text-xl font-bold mb-4">{focusNode.displayName}</h2>

      <div className="mb-6">
        <h3 className="font-semibold mb-2">Parents</h3>
        {getParents(focusPersonId).length > 0 ? (
          <ul className="space-y-1">
            {getParents(focusPersonId).map(parent => (
              <li key={parent.id}>
                <Link href={`/p/${parent.id}`} className="text-blue-600 hover:underline">
                  {parent.displayName}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-gray-500">No parents recorded</p>
        )}
      </div>

      <div>
        <h3 className="font-semibold mb-2">Children</h3>
        {getChildren(focusPersonId).length > 0 ? (
          <div className="space-y-1">
            {getChildren(focusPersonId).map(child => (
              <NodeItem key={child.id} node={child} depth={1} />
            ))}
          </div>
        ) : (
          <p className="text-gray-500">No children recorded</p>
        )}
      </div>
    </div>
  );
}
