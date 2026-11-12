"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

/**
 * Alpha Scout hero visual — a slowly rotating wireframe globe with a
 * sparse field of points, in muted deep-green/grey on the light page.
 * Lightweight (no textures), pauses when off-screen, and falls back to
 * a static ring graphic when WebGL is unavailable.
 */
export default function Hero3D() {
  const mountRef = useRef<HTMLDivElement>(null);
  const [webglFailed, setWebglFailed] = useState(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: "low-power",
      });
    } catch {
      setWebglFailed(true);
      return;
    }
    if (!renderer.getContext()) {
      setWebglFailed(true);
      renderer.dispose();
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      42,
      mount.clientWidth / mount.clientHeight,
      0.1,
      100,
    );
    camera.position.z = 6.2;

    const group = new THREE.Group();
    scene.add(group);

    // Wireframe globe
    const globe = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.7, 1),
      new THREE.MeshBasicMaterial({
        color: 0x166534,
        wireframe: true,
        transparent: true,
        opacity: 0.42,
      }),
    );
    group.add(globe);

    // Inner solid core, very faint, to give the globe body
    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.68, 2),
      new THREE.MeshBasicMaterial({
        color: 0x166534,
        transparent: true,
        opacity: 0.04,
      }),
    );
    group.add(core);

    // Sparse field of small points on a slightly larger shell
    const pointCount = 260;
    const positions = new Float32Array(pointCount * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < pointCount; i++) {
      v.randomDirection().multiplyScalar(2.05 + Math.random() * 0.55);
      positions.set([v.x, v.y, v.z], i * 3);
    }
    const pointsGeo = new THREE.BufferGeometry();
    pointsGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const points = new THREE.Points(
      pointsGeo,
      new THREE.PointsMaterial({
        color: 0x57534e,
        size: 0.035,
        transparent: true,
        opacity: 0.55,
      }),
    );
    group.add(points);

    // Thin orbit ring, tilted
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(2.45, 0.006, 8, 128),
      new THREE.MeshBasicMaterial({
        color: 0x166534,
        transparent: true,
        opacity: 0.3,
      }),
    );
    ring.rotation.x = Math.PI / 2.6;
    ring.rotation.y = 0.35;
    group.add(ring);

    // Gentle mouse parallax
    let targetX = 0;
    let targetY = 0;
    const onPointerMove = (e: PointerEvent) => {
      const rect = mount.getBoundingClientRect();
      targetX = ((e.clientX - rect.left) / rect.width - 0.5) * 0.45;
      targetY = ((e.clientY - rect.top) / rect.height - 0.5) * 0.3;
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });

    // Pause when off-screen or tab hidden
    let visible = true;
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
      },
      { threshold: 0 },
    );
    observer.observe(mount);

    const onResize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);

    const clock = new THREE.Clock();
    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      if (!visible || document.hidden) return;
      const t = clock.getDelta();
      group.rotation.y += t * 0.12;
      group.rotation.x += (targetY - group.rotation.x) * 0.04;
      group.rotation.z += (targetX * 0.4 - group.rotation.z) * 0.03;
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("resize", onResize);
      globe.geometry.dispose();
      (globe.material as THREE.Material).dispose();
      core.geometry.dispose();
      (core.material as THREE.Material).dispose();
      pointsGeo.dispose();
      (points.material as THREE.Material).dispose();
      ring.geometry.dispose();
      (ring.material as THREE.Material).dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, []);

  if (webglFailed) {
    // Static fallback: calm concentric rings, no error, no blank box.
    return (
      <div
        aria-hidden="true"
        className="relative mx-auto h-64 w-64 md:h-80 md:w-80"
      >
        <div className="absolute inset-0 rounded-full border border-green-800/25" />
        <div className="absolute inset-8 rounded-full border border-green-800/20" />
        <div className="absolute inset-16 rounded-full border border-green-800/15" />
        <div className="absolute inset-24 rounded-full bg-green-800/5" />
        <div className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-green-800/60" />
      </div>
    );
  }

  return (
    <div
      ref={mountRef}
      aria-hidden="true"
      className="h-64 w-full md:h-80 lg:h-96"
    />
  );
}
