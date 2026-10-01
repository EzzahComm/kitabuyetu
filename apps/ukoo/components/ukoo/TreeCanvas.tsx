'use client';

import { useEffect, useRef, useState } from 'react';
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

export default function TreeCanvas({ spaceId, focusPersonId }: { spaceId: string; focusPersonId: string }) {
  const canvasRef = useRef<SVGSVGElement>(null);
  const [treeData, setTreeData] = useState<TreeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(focusPersonId);

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

  useEffect(() => {
    if (!treeData || !canvasRef.current) return;

    const svg = canvasRef.current;
    const width = svg.clientWidth;
    const height = svg.clientHeight;

    // Clear SVG
    while (svg.firstChild) {
      svg.removeChild(svg.firstChild);
    }

    // Simple grid layout (Phase 1 stub; Phase 2 uses D3 + ELK.js)
    const nodes = treeData.nodes;
    const nodeRadius = 30;
    const xSpacing = 120;
    const ySpacing = 80;

    // Position nodes in a basic tree layout
    const positions = new Map<string, { x: number; y: number }>();
    nodes.forEach((node, idx) => {
      positions.set(node.id, {
        x: 100 + (idx % 5) * xSpacing,
        y: 100 + Math.floor(idx / 5) * ySpacing,
      });
    });

    // Draw edges
    treeData.edges.forEach(edge => {
      const childPos = positions.get(edge.childId);
      const parentPos = positions.get(edge.parentId);
      if (!childPos || !parentPos) return;

      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', childPos.x.toString());
      line.setAttribute('y1', childPos.y.toString());
      line.setAttribute('x2', parentPos.x.toString());
      line.setAttribute('y2', parentPos.y.toString());
      line.setAttribute('stroke', '#999');
      line.setAttribute('stroke-width', '2');
      svg.appendChild(line);
    });

    // Draw nodes
    nodes.forEach(node => {
      const pos = positions.get(node.id)!;
      const isSelected = node.id === selectedNodeId;

      // Circle background
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', pos.x.toString());
      circle.setAttribute('cy', pos.y.toString());
      circle.setAttribute('r', nodeRadius.toString());
      circle.setAttribute('fill', isSelected ? '#3b82f6' : node.sex === 'male' ? '#dbeafe' : '#fce7f3');
      circle.setAttribute('stroke', isSelected ? '#1e40af' : '#ccc');
      circle.setAttribute('stroke-width', isSelected ? '3' : '1');
      circle.setAttribute('cursor', 'pointer');
      circle.addEventListener('click', () => setSelectedNodeId(node.id));
      svg.appendChild(circle);

      // Text label
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', pos.x.toString());
      text.setAttribute('y', pos.y.toString());
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dy', '0.3em');
      text.setAttribute('font-size', '12');
      text.setAttribute('pointer-events', 'none');
      text.textContent = node.displayName.split(' ')[0];
      svg.appendChild(text);
    });
  }, [treeData, selectedNodeId]);

  if (loading) return <div className="p-4">Loading tree...</div>;

  if (!treeData) return <div className="p-4">Failed to load tree</div>;

  return (
    <div className="flex gap-4">
      <svg
        ref={canvasRef}
        className="flex-1 border rounded bg-white"
        style={{ minHeight: '600px', width: '100%' }}
      />
      {selectedNodeId && treeData.nodes.find(n => n.id === selectedNodeId) && (
        <div className="w-80 p-4 border rounded bg-gray-50">
          <div className="mb-4">
            <h2 className="text-xl font-bold">
              {treeData.nodes.find(n => n.id === selectedNodeId)?.displayName}
            </h2>
            <p className="text-sm text-gray-600">
              {treeData.nodes.find(n => n.id === selectedNodeId)?.sex}
            </p>
          </div>
          <div className="space-y-2">
            <Link href={`/p/${selectedNodeId}`} className="block p-2 bg-blue-500 text-white rounded text-center">
              View Full Profile
            </Link>
            <button
              onClick={() => setSelectedNodeId(null)}
              className="w-full p-2 bg-gray-300 rounded"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
