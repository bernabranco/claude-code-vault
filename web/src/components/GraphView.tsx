import { useEffect, useRef } from "react";
import ForceGraph3D, {
  type ForceGraph3DInstance,
  type NodeObject,
  type LinkObject,
} from "3d-force-graph";
import * as THREE from "three";
import type { GraphData } from "../types";

type GraphNode = NodeObject & {
  id: string;
  label: string;
  size: number;
};

type GraphLink = LinkObject<GraphNode> & {
  source: string;
  target: string;
};

interface GraphViewProps {
  graphData: GraphData | null;
  selectedNodeId?: string;
  onNodeClick: (nodeId: string) => void;
  loading?: boolean;
  isDark?: boolean;
}

function makeLabelSprite(text: string, color: string): THREE.Sprite {
  const padding = 8;
  const fontSize = 36;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  ctx.font = `${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
  const metrics = ctx.measureText(text);
  canvas.width = Math.ceil(metrics.width) + padding * 2;
  canvas.height = fontSize + padding * 2;

  ctx.font = `${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.fillText(text, padding, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  const scale = 0.18;
  sprite.scale.set(canvas.width * scale, canvas.height * scale, 1);
  return sprite;
}

export function GraphView({
  graphData,
  selectedNodeId,
  onNodeClick,
  loading = false,
  isDark = false,
}: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<ForceGraph3DInstance<GraphNode, GraphLink> | null>(null);

  // Initialize graph once
  useEffect(() => {
    if (!containerRef.current) return;

    const graph = new ForceGraph3D(
      containerRef.current
    ) as unknown as ForceGraph3DInstance<GraphNode, GraphLink>;
    graphRef.current = graph;

    graph
      .nodeLabel((n) => n.label)
      .nodeVal((n) => n.size)
      .linkDirectionalArrowLength(3)
      .linkDirectionalArrowRelPos(1)
      .linkDirectionalParticles(2)
      .linkDirectionalParticleWidth(1.2)
      .linkWidth(0.5)
      .linkOpacity(0.6)
      .onNodeClick((node) => {
        if (typeof node.id === "string") onNodeClick(node.id);
      });

    graph.d3Force("link")?.distance(90);
    graph.d3Force("charge")?.strength(-250);

    const handleResize = () => {
      if (!containerRef.current || !graphRef.current) return;
      graphRef.current.width(containerRef.current.clientWidth);
      graphRef.current.height(containerRef.current.clientHeight);
    };
    handleResize();

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(containerRef.current);
    window.addEventListener("resize", handleResize);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", handleResize);
      graph._destructor?.();
      graphRef.current = null;
    };
  }, []);

  // Update theme colors
  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;

    const bgColor = isDark ? "#000" : "#fff";
    const nodeColor = isDark ? "#888" : "#bbb";
    const selectedColor = isDark ? "#fff" : "#000";
    const linkColor = isDark ? "#4a9eff" : "#0066cc";
    const labelColor = isDark ? "#fff" : "#000";

    graph
      .backgroundColor(bgColor)
      .linkColor(() => linkColor)
      .nodeThreeObject((node) => {
        const group = new THREE.Group();

        const radius = Math.cbrt(node.size) * 2;
        const sphere = new THREE.Mesh(
          new THREE.SphereGeometry(radius, 24, 24),
          new THREE.MeshLambertMaterial({
            color: node.id === selectedNodeId ? selectedColor : nodeColor,
          })
        );
        group.add(sphere);

        const label = makeLabelSprite(node.label, labelColor);
        label.position.set(0, radius + 2, 0);
        group.add(label);

        return group;
      });

    graph.refresh();
  }, [isDark, selectedNodeId]);

  // Load data
  useEffect(() => {
    const graph = graphRef.current;
    if (!graph || !graphData) return;

    const linkCounts = new Map<string, number>();
    graphData.nodes.forEach((n) => linkCounts.set(n.id, 0));
    graphData.edges.forEach((e) => {
      linkCounts.set(e.source, (linkCounts.get(e.source) || 0) + 1);
      linkCounts.set(e.target, (linkCounts.get(e.target) || 0) + 1);
    });
    const maxLinks = Math.max(...Array.from(linkCounts.values()), 1);

    const nodes: GraphNode[] = graphData.nodes.map((n) => {
      const count = linkCounts.get(n.id) || 0;
      // nodeVal drives sphere volume; 3..20 range feels right
      const size = 3 + (count / maxLinks) * 17;
      return { id: n.id, label: n.title, size };
    });

    const nodeIds = new Set(nodes.map((n) => n.id));
    const links: GraphLink[] = graphData.edges
      .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
      .map((e) => ({ source: e.source, target: e.target }));

    graph.graphData({ nodes, links });
  }, [graphData]);

  const bgColor = isDark ? "#000" : "#fff";

  return (
    <div className="relative w-full h-full" style={{ backgroundColor: bgColor }}>
      {loading && (
        <div
          className="absolute inset-0 flex items-center justify-center z-10"
          style={{ backgroundColor: bgColor }}
        >
          <div style={{ color: "#999" }}>Loading 3D graph...</div>
        </div>
      )}

      <div ref={containerRef} className="w-full h-full" />

      <div
        className="absolute bottom-4 right-4 rounded-lg p-4 text-xs shadow-lg"
        style={{
          backgroundColor: bgColor,
          border: `1px solid ${isDark ? "#333" : "#e5e5e5"}`,
        }}
      >
        <div className="font-semibold mb-3" style={{ color: isDark ? "#fff" : "#000" }}>
          3D Graph Guide:
        </div>
        <div className="space-y-2" style={{ color: "#999" }}>
          <div>
            <div className="text-xs font-medium mb-1" style={{ color: isDark ? "#fff" : "#000" }}>
              Navigation
            </div>
            <div className="text-xs">Drag = Rotate • Scroll = Zoom • Right-drag = Pan</div>
          </div>
          <div className="mt-2">
            <div className="text-xs font-medium mb-1" style={{ color: isDark ? "#fff" : "#000" }}>
              Node Size
            </div>
            <div className="text-xs">Larger = more connections</div>
          </div>
          <div className="mt-2">
            <div className="text-xs font-medium mb-1" style={{ color: isDark ? "#fff" : "#000" }}>
              Click
            </div>
            <div className="text-xs">Click any node to view</div>
          </div>
        </div>
      </div>
    </div>
  );
}
