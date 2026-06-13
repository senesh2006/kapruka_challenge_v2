import { Component, Suspense, useMemo, useRef, type ReactNode } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { useGLTF, Environment } from "@react-three/drei";
import * as THREE from "three";
import type { ConciergeEmotion } from "@sevana/channels";

export interface Avatar3DProps {
  /** Ready Player Me .glb URL. When absent, the animated energy-orb avatar renders. */
  avatarUrl?: string;
  emotion: ConciergeEmotion;
  speaking: boolean;
  listening: boolean;
}

// Emotion → accent colour (used by the orb + the rim light).
const EMOTION_COLOR: Record<ConciergeEmotion, string> = {
  neutral: "#3b82f6",
  warm: "#f59e0b",
  excited: "#ec4899",
  thoughtful: "#6366f1",
  apologetic: "#64748b",
  celebratory: "#22c55e",
  condolence: "#94a3b8",
};

// Emotion → ARKit morph-target targets (Ready Player Me blendshapes).
function emotionMorphs(emotion: ConciergeEmotion): Record<string, number> {
  switch (emotion) {
    case "excited":
      return { mouthSmileLeft: 0.7, mouthSmileRight: 0.7, browInnerUp: 0.35, browOuterUpLeft: 0.3, browOuterUpRight: 0.3, cheekSquintLeft: 0.3, cheekSquintRight: 0.3 };
    case "celebratory":
      return { mouthSmileLeft: 0.9, mouthSmileRight: 0.9, browOuterUpLeft: 0.4, browOuterUpRight: 0.4, cheekSquintLeft: 0.4, cheekSquintRight: 0.4 };
    case "warm":
      return { mouthSmileLeft: 0.4, mouthSmileRight: 0.4, browInnerUp: 0.1 };
    case "thoughtful":
      return { browInnerUp: 0.3, browDownLeft: 0.15, browDownRight: 0.15, mouthPressLeft: 0.15, mouthPressRight: 0.15 };
    case "apologetic":
      return { browInnerUp: 0.5, mouthFrownLeft: 0.3, mouthFrownRight: 0.3 };
    case "condolence":
      // Soft, lowered, no smile — a gentle, sympathetic face.
      return { browInnerUp: 0.6, mouthFrownLeft: 0.2, mouthFrownRight: 0.2, eyeLookDownLeft: 0.2, eyeLookDownRight: 0.2 };
    default:
      return {};
  }
}

// ---------------- Ready Player Me avatar ----------------

function ReadyPlayerMeAvatar({ avatarUrl, emotion, speaking }: { avatarUrl: string; emotion: ConciergeEmotion; speaking: boolean }) {
  const { scene } = useGLTF(avatarUrl);
  const group = useRef<THREE.Group>(null);
  const blink = useRef({ next: 1.5, closing: 0 });

  // Collect every mesh that carries morph targets (head, teeth).
  const morphMeshes = useMemo(() => {
    const meshes: THREE.Mesh[] = [];
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.morphTargetDictionary && m.morphTargetInfluences) meshes.push(m);
    });
    return meshes;
  }, [scene]);

  const setMorph = (name: string, value: number, lerp = 0.25) => {
    for (const mesh of morphMeshes) {
      const idx = mesh.morphTargetDictionary?.[name];
      if (idx === undefined || !mesh.morphTargetInfluences) continue;
      mesh.morphTargetInfluences[idx] = THREE.MathUtils.lerp(mesh.morphTargetInfluences[idx] ?? 0, value, lerp);
    }
  };

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;

    // Idle breathing + micro head sway.
    if (group.current) {
      group.current.position.y = -1.45 + Math.sin(t * 1.1) * 0.012;
      group.current.rotation.y = Math.sin(t * 0.4) * 0.06;
      group.current.rotation.x = Math.sin(t * 0.7) * 0.02;
    }

    // Blink.
    blink.current.next -= delta;
    if (blink.current.next <= 0) {
      blink.current.closing = 1;
      blink.current.next = 2.5 + Math.random() * 3;
    }
    const blinkVal = blink.current.closing;
    setMorph("eyeBlinkLeft", blinkVal, 0.5);
    setMorph("eyeBlinkRight", blinkVal, 0.5);
    if (blink.current.closing > 0) blink.current.closing = Math.max(0, blink.current.closing - delta * 8);

    // Talking — natural jaw + mouth oscillation while speaking.
    if (speaking) {
      const open = (Math.sin(t * 11) * 0.5 + 0.5) * (Math.sin(t * 17) * 0.3 + 0.7);
      setMorph("jawOpen", 0.12 + open * 0.32, 0.5);
      setMorph("mouthOpen", open * 0.25, 0.5);
    } else {
      setMorph("jawOpen", 0, 0.3);
      setMorph("mouthOpen", 0, 0.3);
    }

    // Emotion expression (don't fight the blink/jaw).
    const morphs = emotionMorphs(emotion);
    for (const [name, value] of Object.entries(morphs)) setMorph(name, value, 0.04);
  });

  return (
    <group ref={group} position={[0, -1.45, 0]}>
      <primitive object={scene} />
    </group>
  );
}

// ---------------- Energy-orb fallback (no external asset) ----------------

function EnergyOrb({ emotion, speaking, listening }: { emotion: ConciergeEmotion; speaking: boolean; listening: boolean }) {
  const core = useRef<THREE.Mesh>(null);
  const ring1 = useRef<THREE.Mesh>(null);
  const ring2 = useRef<THREE.Mesh>(null);
  const color = new THREE.Color(EMOTION_COLOR[emotion]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const pulse = speaking ? Math.sin(t * 14) * 0.08 + Math.sin(t * 23) * 0.04 : Math.sin(t * 1.5) * 0.03;
    const base = listening ? 1.08 : 1;
    if (core.current) {
      const s = base + pulse;
      core.current.scale.setScalar(s);
      core.current.rotation.y = t * 0.3;
      core.current.rotation.x = t * 0.15;
    }
    if (ring1.current) {
      ring1.current.rotation.z = t * 0.5;
      ring1.current.rotation.x = Math.PI / 3 + Math.sin(t * 0.4) * 0.2;
    }
    if (ring2.current) {
      ring2.current.rotation.z = -t * 0.35;
      ring2.current.rotation.y = Math.PI / 4 + Math.cos(t * 0.5) * 0.2;
    }
  });

  return (
    <group>
      <mesh ref={core}>
        <icosahedronGeometry args={[1, 4]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={speaking ? 0.9 : 0.5} roughness={0.25} metalness={0.4} />
      </mesh>
      <mesh ref={ring1}>
        <torusGeometry args={[1.55, 0.02, 16, 100]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.7} />
      </mesh>
      <mesh ref={ring2}>
        <torusGeometry args={[1.85, 0.015, 16, 100]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} transparent opacity={0.7} />
      </mesh>
    </group>
  );
}

// ---------------- error boundary → orb fallback ----------------

class AvatarErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  constructor(props: { fallback: ReactNode; children: ReactNode }) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

// ---------------- public component ----------------

export function Avatar3D({ avatarUrl, emotion, speaking, listening }: Avatar3DProps) {
  const accent = EMOTION_COLOR[emotion];
  return (
    <Canvas
      camera={{ position: [0, 0, 3.2], fov: 30 }}
      gl={{ antialias: true, alpha: true }}
      dpr={[1, 2]}
      style={{ width: "100%", height: "100%" }}
    >
      <ambientLight intensity={0.7} />
      <directionalLight position={[2, 3, 4]} intensity={1.1} />
      <pointLight position={[-3, 1, 2]} intensity={0.6} color={accent} />
      <Suspense fallback={<EnergyOrb emotion={emotion} speaking={speaking} listening={listening} />}>
        {avatarUrl ? (
          <AvatarErrorBoundary fallback={<EnergyOrb emotion={emotion} speaking={speaking} listening={listening} />}>
            <ReadyPlayerMeAvatar avatarUrl={avatarUrl} emotion={emotion} speaking={speaking} />
            <Environment preset="city" />
          </AvatarErrorBoundary>
        ) : (
          <EnergyOrb emotion={emotion} speaking={speaking} listening={listening} />
        )}
      </Suspense>
    </Canvas>
  );
}
